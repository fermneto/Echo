import { randomUUID } from "node:crypto";
import { allOrgIds, createGithubGainsHistory, dueAwayDigests, dueEndOfDay, dueMorning, needsGainsBaseline, serverAwayDigest, serverEndOfDay, serverGains, serverMorningPlan, serverNightReview, serverRedistribution, serverWeeklyReport, dueWeeklyReports } from "@echo/agents/server";
import { ensureProductNote } from "@echo/brain/pg";
import { loadConfig } from "@echo/config";
import { createDb, createPool } from "@echo/db";
import { PgBossQueue, QUEUES, type PingMessage } from "@echo/jobs";
import { createLogger, initTracing, LogRunRecorder } from "@echo/observability";
import { writersFromEnv } from "@echo/actions";
import * as agents from "@echo/agents";
import type { AnswerRequest, AnswerResult } from "@echo/agents";
import { giveUpStaleQuestions, handleSlackInteraction, handleSlackMessage } from "./slack-answer.ts";
import { createInteractionRouter } from "./slack-interactions.ts";
import type { SlackMessageJob } from "./inbox.ts";
import { registerActions } from "./actions.ts";
import { registerInbox } from "./inbox.ts";
import { scheduleReconcile } from "./reconcile.ts";
import { githubForOrg, platformsFromEnv } from "@echo/connectors";
import { registerEndOfDay } from "./end-of-day.ts";
import { registerNight } from "./night.ts";
import { registerRedistribution } from "./redistribution.ts";
import { registerWeeklyReport } from "./weekly-report.ts";
import { registerGains } from "./gains.ts";

const cfg = loadConfig("worker");
const log = createLogger("worker", cfg.LOG_LEVEL);
const flush = initTracing({ publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY, baseUrl: cfg.LANGFUSE_BASE_URL });
const queue = new PgBossQueue(cfg.DATABASE_URL);

const pool = createPool(cfg.DATABASE_URL);
const db = createDb(pool);

await queue.start();
// Até a gravação em agent_runs estar ligada (frente Funções), as execuções vão para o log.
const runs = new LogRunRecorder(log);
await registerInbox(db, queue, runs, { brainsRepository: cfg.BRAINS_REPOSITORY });
const stopActions = await registerActions({ db, writers: writersFromEnv(db, cfg) }, queue, runs, log);
// F2: resposta no Slack com o fluxo da frente Funções (answer de @echo/agents).
const interactions = createInteractionRouter(log);
let giveUp: ReturnType<typeof setInterval> | undefined;
const platforms = platformsFromEnv(cfg);
const answer = (agents as { answer?: (req: AnswerRequest) => Promise<AnswerResult> }).answer;
if (platforms.chat && answer) {
  const chat = platforms.chat;
  const workerId = `worker:${process.pid}`;
  await queue.work<SlackMessageJob>(QUEUES.slackMessage, async (job) => {
    const outcome = await handleSlackMessage({ db, chat, answer, log, workerId, alwaysAway: cfg.DEMO_ALWAYS_AWAY }, job.data);
    log.info({ orgId: job.data.orgId, outcome }, "mensagem do Slack");
  });
  // Um só consumidor dos cliques; outros fluxos (ex.: Confirmar a nota do dia) entram com interactions.add.
  interactions.add("resolveu", (job) => handleSlackInteraction({ db, log }, job));
  // A cada 10 minutos: pergunta sem resposta há 1 hora vira falha e quem perguntou é avisado.
  giveUp = setInterval(() => void giveUpStaleQuestions({ db, chat, log }).catch((err) => log.error({ err: String(err) }, "falha na rodada das perguntas paradas")), 10 * 60_000);
} else {
  log.warn({ slack: Boolean(platforms.chat), answer: Boolean(answer) }, "resposta no Slack desligada: falta SLACK_BOT_TOKEN ou o fluxo answer() de @echo/agents");
}

const stopReconcile = scheduleReconcile({ db, pool, platforms, runs, log, brainsRepository: cfg.BRAINS_REPOSITORY, queue }, cfg.RECONCILE_INTERVAL_MS);
log.info({ demo: cfg.DEMO_MODE }, "worker no ar");
// Nota do produto em toda empresa que ainda não a tem (etapa 5). Falha aqui não derruba o worker.
await ensureProductNote(db).then(
  (created) => created > 0 && log.info({ created }, "nota do produto criada"),
  (err) => log.error({ err }, "falha ao criar a nota do produto"),
);

// Fim do expediente (F3): nota do dia com confirmação da pessoa. Execuções gravadas em agent_runs.
// O Confirmar da nota entra no roteador único da fila slack.interaction (não registra outro consumidor).
const endOfDay = await registerEndOfDay(queue, { flow: serverEndOfDay(db, cfg.ANTHROPIC_API_KEY, cfg.WEB_URL), scan: (now) => dueEndOfDay(db, now), interactions });
// Um só consumidor dos cliques, depois de todos os tratadores registrados (resolveu e nota do dia).
await interactions.listen(queue);
const runEndOfDay = () =>
  endOfDay.tick().then(
    (queued) => queued > 0 && log.info({ queued }, "rascunhos da nota do dia na fila"),
    (err) => log.error({ err }, "falha na agenda do fim do expediente"),
  );
void runEndOfDay();
const endOfDayTimer = setInterval(() => void runEndOfDay(), cfg.END_OF_DAY_SCAN_MS);

// Noite (F4) e manhã (F5). O diff dos PRs vem do GitHub pela frente de Integrações; até a porta existir,
// nenhum PR tem diff e a revisão noturna não envia lote.
const night = await registerNight(queue, {
  night: serverNightReview(db, cfg.ANTHROPIC_API_KEY, () => ({ getDiff: async () => null })),
  morning: serverMorningPlan(db, cfg.WEB_URL),
  orgIds: () => allOrgIds(db),
  dueMorning: (now) => dueMorning(db, now),
  nightHourUtc: cfg.NIGHT_REVIEW_UTC_HOUR,
});
const runNight = () =>
  night.tick().then(
    (r) => (r.night > 0 || r.morning > 0) && log.info(r, "noite e manhã na fila"),
    (err) => log.error({ err }, "falha na agenda da noite e da manhã"),
  );
void runNight();
const nightTimer = setInterval(() => void runNight(), cfg.END_OF_DAY_SCAN_MS);

// Redistribuição (etapa 11): plano por regra na ausência; nada muda antes da aprovação da liderança.
const redistribution = await registerRedistribution(queue, { flow: serverRedistribution(db, cfg.WEB_URL), orgIds: () => allOrgIds(db) });
const runRedistribution = () => redistribution.tick().catch((err) => log.error({ err }, "falha na agenda da redistribuição"));
void runRedistribution();
const redistributionTimer = setInterval(() => void runRedistribution(), cfg.END_OF_DAY_SCAN_MS);

// Relatório semanal (etapa 12): no corte de cada pessoa; aviso, observação e envio ao RH em 3 dias.
const weeklyReport = await registerWeeklyReport(queue, { flow: serverWeeklyReport(db, cfg.ANTHROPIC_API_KEY, cfg.WEB_URL), orgIds: () => allOrgIds(db), due: (now) => dueWeeklyReports(db, now) });
const runWeeklyReport = () =>
  weeklyReport.tick().then(
    (r) => r.built > 0 && log.info(r, "relatórios semanais na fila"),
    (err) => log.error({ err }, "falha na agenda do relatório semanal"),
  );
void runWeeklyReport();
const weeklyReportTimer = setInterval(() => void runWeeklyReport(), cfg.END_OF_DAY_SCAN_MS);

// Resumo da ausência e Ganhos (etapa 13): resumo no início e no fim do expediente, limpeza das linhas e a
// referência de 90 dias do GitHub, uma vez por empresa, quando a conta está ligada.
const gains = await registerGains(queue, {
  digest: serverAwayDigest(db, cfg.WEB_URL),
  gains: serverGains(db),
  dueDigests: (now) => dueAwayDigests(db, now),
  orgIds: () => allOrgIds(db),
  needsBaseline: (orgId) => needsGainsBaseline(db, orgId),
  history: async (orgId) => {
    const gh = await githubForOrg(db, platforms, orgId);
    return gh ? createGithubGainsHistory(db, orgId, gh) : null;
  },
});
const runGains = () =>
  gains.tick().then(
    (r) => (r.digests > 0 || r.purged > 0 || r.baselines > 0) && log.info(r, "resumos da ausência e ganhos"),
    (err) => log.error({ err }, "falha na agenda do resumo da ausência e dos ganhos"),
  );
void runGains();
const gainsTimer = setInterval(() => void runGains(), cfg.END_OF_DAY_SCAN_MS);

// Confirma, a cada início, que a fila chega ao reviewer.
await queue.work<PingMessage>(QUEUES.reviewerPong, async (job) => log.info({ nonce: job.data.nonce }, "reviewer respondeu ao ping"));
await queue.send<PingMessage>(QUEUES.reviewerPing, { from: "worker", sentAt: new Date().toISOString(), nonce: randomUUID() });

const heartbeat = setInterval(() => log.info({ uptimeS: Math.round(process.uptime()) }, "heartbeat"), cfg.HEARTBEAT_INTERVAL_MS);

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando worker");
  clearInterval(heartbeat);
  stopActions();
  stopReconcile();
  if (giveUp) clearInterval(giveUp);
  clearInterval(endOfDayTimer);
  clearInterval(nightTimer);
  clearInterval(redistributionTimer);
  clearInterval(weeklyReportTimer);
  clearInterval(gainsTimer);
  await Promise.allSettled([queue.stop(), pool.end(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
