import { calendarsForOrg, connectedOrgs, githubForOrg, reconcileGithub, reconcileLinear, syncCalendar, type CalendarSyncResult, type Platforms } from "@echo/connectors";
import { QUEUES, type JobQueue } from "@echo/jobs";
import type { createPool, Database } from "@echo/db";
import { withRun, type Logger, type RunRecorder } from "@echo/observability";
import { mirrorOrg } from "./mirror.ts";

/** Chave da trava no Postgres: só um worker reconcilia por vez. */
const LOCK_KEY = 41_2026_11;

export interface ReconcileDeps {
  db: Database;
  pool: ReturnType<typeof createPool>;
  platforms: Platforms;
  runs: RunRecorder;
  log: Logger;
  brainsRepository?: string | undefined;
  /** Para avisar a liderança das férias detectadas na agenda. */
  queue?: Pick<JobQueue, "send">;
  now?: () => Date;
}

/**
 * A reconciliação roda a cada 10 min por empresa: em `agent_runs` fica só a rodada que trouxe algo novo,
 * avisou erro parcial ou falhou. GitHub: PR fechado desde a última rodada ou erro em algum repositório.
 * Linear: a leitura é a lista inteira (sem como saber o que é novo), então só falha e lista truncada.
 * Agenda: ausência registrada, alterada, cancelada ou sugerida, horário sugerido ou erro.
 */
function calendarChanged(r: CalendarSyncResult): boolean {
  return r.registered + r.updated + r.cancelled + r.suggestions.length + r.shortRegistered.length + r.workHoursSuggested + r.errors.length > 0;
}

/** Uma rodada: reenvia avisos falhos do GitHub e reconcilia cada empresa ligada. */
export async function reconcileOnce(d: ReconcileDeps): Promise<{ skipped: boolean }> {
  const client = await d.pool.connect();
  try {
    const { rows } = await client.query<{ ok: boolean }>("select pg_try_advisory_lock($1) as ok", [LOCK_KEY]);
    if (!rows[0]?.ok) return { skipped: true };
    try {
      const now = d.now?.() ?? new Date();
      if (d.platforms.github) {
        // Uma falha no reenvio não impede a importação, que é o que cobre as lacunas.
        // Vale para todas as empresas (sem orgId): fica só no log, não em agent_runs.
        await withRun(d.runs, "reconcile_redeliver", async () => {
          const n = await d.platforms.github!.redeliverFailedWebhooks();
          if (n) d.log.info({ reenviados: n }, "avisos do GitHub pedidos de novo");
          return n;
        }, {}, { keep: (n) => n > 0 }).catch((err) => d.log.warn({ err: String(err) }, "falha ao pedir reenvio ao GitHub"));
      }
      for (const { orgId, kinds } of await connectedOrgs(d.db)) {
        if (kinds.includes("github")) {
          const gh = await githubForOrg(d.db, d.platforms, orgId);
          if (gh) {
            await withRun(d.runs, "reconcile_github", async () => {
              const r = await reconcileGithub(d.db, orgId, gh, now, { brainsRepository: d.brainsRepository });
              d.log.info({ orgId, ...r }, "reconciliação do GitHub");
              return r;
            }, { orgId }, { keep: (r) => r.closedSinceLastRun > 0 || r.errors.length > 0 }).catch((err) => d.log.error({ orgId, err: String(err) }, "falha na reconciliação do GitHub"));
            // Pela mesma fila do push (uma por empresa), para duas sincronizações da mesma empresa não correrem juntas.
            if (d.queue && d.brainsRepository) await d.queue.send(QUEUES.brainMirror, { orgId }, { singletonKey: orgId }).catch((err) => d.log.error({ orgId, err: String(err) }, "falha ao pedir o espelho das notas"));
            else await mirrorOrg(d, orgId).catch((err) => d.log.error({ orgId, err: String(err) }, "falha no espelho das notas"));
          }
        }
        for (const cal of await calendarsForOrg(d.db, d.platforms, orgId)) {
          await withRun(d.runs, `calendar_${cal.provider}`, async () => {
            const r = await syncCalendar(d.db, orgId, cal, now);
            for (const s of r.suggestions) await d.queue?.send(QUEUES.absenceSuggested, { orgId, ...s }, { singletonKey: s.absenceId });
            d.log.info({ orgId, provider: cal.provider, ...r, suggestions: r.suggestions.length, shortRegistered: r.shortRegistered.length }, "sincronização da agenda");
            return r;
          }, { orgId }, { keep: calendarChanged }).catch((err) => d.log.error({ orgId, err: String(err) }, "falha na sincronização da agenda"));
        }
        if (kinds.includes("linear") && d.platforms.linear) {
          await withRun(d.runs, "reconcile_linear", async () => {
            const r = await reconcileLinear(d.db, orgId, d.platforms.linear!, now);
            d.log.info({ orgId, ...r }, "reconciliação do Linear");
            return r;
          }, { orgId }, { keep: (r) => r.truncated }).catch((err) => d.log.error({ orgId, err: String(err) }, "falha na reconciliação do Linear"));
        }
      }
      return { skipped: false };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

/** Agenda a reconciliação: uma vez logo depois de subir e depois a cada intervalo. */
export function scheduleReconcile(d: ReconcileDeps, intervalMs: number, firstDelayMs = 30_000): () => void {
  const tick = () => void reconcileOnce(d).catch((err) => d.log.error({ err: String(err) }, "falha na rodada de reconciliação"));
  const first = setTimeout(tick, firstDelayMs);
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
