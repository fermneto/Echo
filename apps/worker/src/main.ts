import { randomUUID } from "node:crypto";
import { loadConfig } from "@echo/config";
import { createDb, createPool } from "@echo/db";
import { PgBossQueue, QUEUES, type PingMessage } from "@echo/jobs";
import { createLogger, initTracing, LogRunRecorder } from "@echo/observability";
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

// Confirma, a cada início, que a fila chega ao reviewer.
await queue.work<PingMessage>(QUEUES.reviewerPong, async (job) => log.info({ nonce: job.data.nonce }, "reviewer respondeu ao ping"));
await queue.send<PingMessage>(QUEUES.reviewerPing, { from: "worker", sentAt: new Date().toISOString(), nonce: randomUUID() });

const heartbeat = setInterval(() => log.info({ uptimeS: Math.round(process.uptime()) }, "heartbeat"), cfg.HEARTBEAT_INTERVAL_MS);

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando worker");
  clearInterval(heartbeat);
  await Promise.allSettled([queue.stop(), pool.end(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
