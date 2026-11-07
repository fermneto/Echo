import { randomUUID } from "node:crypto";
import { ensureProductNote } from "@echo/brain/pg";
import { loadConfig } from "@echo/config";
import { createDb, createPool } from "@echo/db";
import { PgBossQueue, QUEUES, type PingMessage } from "@echo/jobs";
import { createLogger, initTracing, LogRunRecorder } from "@echo/observability";
import { writersFromEnv } from "@echo/actions";
import * as agents from "@echo/agents";
import type { AnswerRequest, AnswerResult } from "@echo/agents";
import { handleSlackInteraction, handleSlackMessage } from "./slack-answer.ts";
import type { SlackMessageJob } from "./inbox.ts";
import { registerActions } from "./actions.ts";
import { registerInbox } from "./inbox.ts";
import { scheduleReconcile } from "./reconcile.ts";
import { platformsFromEnv } from "@echo/connectors";

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
const platforms = platformsFromEnv(cfg);
const answer = (agents as { answer?: (req: AnswerRequest) => Promise<AnswerResult> }).answer;
if (platforms.chat && answer) {
  const chat = platforms.chat;
  const workerId = `worker:${process.pid}`;
  await queue.work<SlackMessageJob>(QUEUES.slackMessage, async (job) => {
    const outcome = await handleSlackMessage({ db, chat, answer, log, workerId }, job.data);
    log.info({ orgId: job.data.orgId, outcome }, "mensagem do Slack");
  });
  await queue.work<{ orgId: string; payload: unknown }>(QUEUES.slackInteraction, async (job) => {
    const outcome = await handleSlackInteraction({ db, log }, job.data);
    log.info({ orgId: job.data.orgId, outcome }, "clique no Slack");
  });
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

// Confirma, a cada início, que a fila chega ao reviewer.
await queue.work<PingMessage>(QUEUES.reviewerPong, async (job) => log.info({ nonce: job.data.nonce }, "reviewer respondeu ao ping"));
await queue.send<PingMessage>(QUEUES.reviewerPing, { from: "worker", sentAt: new Date().toISOString(), nonce: randomUUID() });

const heartbeat = setInterval(() => log.info({ uptimeS: Math.round(process.uptime()) }, "heartbeat"), cfg.HEARTBEAT_INTERVAL_MS);

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando worker");
  clearInterval(heartbeat);
  stopActions();
  stopReconcile();
  await Promise.allSettled([queue.stop(), pool.end(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
