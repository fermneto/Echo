import { calendarsForOrg, connectedOrgs, githubForOrg, reconcileGithub, reconcileLinear, syncCalendar, type Platforms } from "@echo/connectors";
import { QUEUES, type JobQueue } from "@echo/jobs";
import type { createPool, Database } from "@echo/db";
import { withRun, type Logger, type RunRecorder } from "@echo/observability";

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
        await withRun(d.runs, "reconcile_redeliver", async () => {
          const n = await d.platforms.github!.redeliverFailedWebhooks();
          if (n) d.log.info({ reenviados: n }, "avisos do GitHub pedidos de novo");
        }).catch((err) => d.log.warn({ err: String(err) }, "falha ao pedir reenvio ao GitHub"));
      }
      for (const { orgId, kinds } of await connectedOrgs(d.db)) {
        if (kinds.includes("github")) {
          const gh = await githubForOrg(d.db, d.platforms, orgId);
          if (gh) {
            await withRun(d.runs, "reconcile_github", async () => {
              const r = await reconcileGithub(d.db, orgId, gh, now, { brainsRepository: d.brainsRepository });
              d.log.info({ orgId, ...r }, "reconciliação do GitHub");
            }, { orgId }).catch((err) => d.log.error({ orgId, err: String(err) }, "falha na reconciliação do GitHub"));
          }
        }
        for (const cal of await calendarsForOrg(d.db, d.platforms, orgId)) {
          await withRun(d.runs, `calendar_${cal.provider}`, async () => {
            const r = await syncCalendar(d.db, orgId, cal, now);
            for (const s of r.suggestions) await d.queue?.send(QUEUES.absenceSuggested, { orgId, ...s }, { singletonKey: s.absenceId });
            d.log.info({ orgId, provider: cal.provider, ...r, suggestions: r.suggestions.length, shortRegistered: r.shortRegistered.length }, "sincronização da agenda");
          }, { orgId }).catch((err) => d.log.error({ orgId, err: String(err) }, "falha na sincronização da agenda"));
        }
        if (kinds.includes("linear") && d.platforms.linear) {
          await withRun(d.runs, "reconcile_linear", async () => {
            const r = await reconcileLinear(d.db, orgId, d.platforms.linear!, now);
            d.log.info({ orgId, ...r }, "reconciliação do Linear");
          }, { orgId }).catch((err) => d.log.error({ orgId, err: String(err) }, "falha na reconciliação do Linear"));
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
