import { randomUUID } from "node:crypto";
import { dueEndOfDay, serverEndOfDay } from "@echo/agents/server";
import { ensureProductNote } from "@echo/brain/pg";
import { loadConfig } from "@echo/config";
import { createDb, createPool } from "@echo/db";
import { PgBossQueue, QUEUES, type PingMessage } from "@echo/jobs";
import { createLogger, initTracing, LogRunRecorder } from "@echo/observability";
import { registerEndOfDay } from "./end-of-day.ts";
import { registerInbox } from "./inbox.ts";

const cfg = loadConfig("worker");
const log = createLogger("worker", cfg.LOG_LEVEL);
const flush = initTracing({ publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY, baseUrl: cfg.LANGFUSE_BASE_URL });
const queue = new PgBossQueue(cfg.DATABASE_URL);

const pool = createPool(cfg.DATABASE_URL);
const db = createDb(pool);

await queue.start();
// Até a gravação em agent_runs estar ligada (frente Funções), as execuções vão para o log.
await registerInbox(db, queue, new LogRunRecorder(log));
log.info({ demo: cfg.DEMO_MODE }, "worker no ar");
// Nota do produto em toda empresa que ainda não a tem (etapa 5). Falha aqui não derruba o worker.
await ensureProductNote(db).then(
  (created) => created > 0 && log.info({ created }, "nota do produto criada"),
  (err) => log.error({ err }, "falha ao criar a nota do produto"),
);

// Fim do expediente (F3): nota do dia com confirmação da pessoa. Execuções gravadas em agent_runs.
const endOfDay = await registerEndOfDay(queue, { flow: serverEndOfDay(db, cfg.ANTHROPIC_API_KEY, cfg.WEB_URL), scan: (now) => dueEndOfDay(db, now) });
const runEndOfDay = () =>
  endOfDay.tick().then(
    (queued) => queued > 0 && log.info({ queued }, "rascunhos da nota do dia na fila"),
    (err) => log.error({ err }, "falha na agenda do fim do expediente"),
  );
void runEndOfDay();
const endOfDayTimer = setInterval(() => void runEndOfDay(), cfg.END_OF_DAY_SCAN_MS);

// Confirma, a cada início, que a fila chega ao reviewer.
await queue.work<PingMessage>(QUEUES.reviewerPong, async (job) => log.info({ nonce: job.data.nonce }, "reviewer respondeu ao ping"));
await queue.send<PingMessage>(QUEUES.reviewerPing, { from: "worker", sentAt: new Date().toISOString(), nonce: randomUUID() });

const heartbeat = setInterval(() => log.info({ uptimeS: Math.round(process.uptime()) }, "heartbeat"), cfg.HEARTBEAT_INTERVAL_MS);

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando worker");
  clearInterval(heartbeat);
  clearInterval(endOfDayTimer);
  await Promise.allSettled([queue.stop(), pool.end(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
