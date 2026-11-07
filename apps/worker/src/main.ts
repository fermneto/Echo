import { randomUUID } from "node:crypto";
import { loadConfig } from "@echo/config";
import { PgBossQueue, QUEUES, type PingMessage } from "@echo/jobs";
import { createLogger, initTracing } from "@echo/observability";

const cfg = loadConfig("worker");
const log = createLogger("worker", cfg.LOG_LEVEL);
const flush = initTracing({ publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY, baseUrl: cfg.LANGFUSE_BASE_URL });
const queue = new PgBossQueue(cfg.DATABASE_URL);

await queue.start();
log.info({ demo: cfg.DEMO_MODE }, "worker no ar");

// Confirma, a cada início, que a fila chega ao reviewer.
await queue.work<PingMessage>(QUEUES.reviewerPong, async (job) => log.info({ nonce: job.data.nonce }, "reviewer respondeu ao ping"));
await queue.send<PingMessage>(QUEUES.reviewerPing, { from: "worker", sentAt: new Date().toISOString(), nonce: randomUUID() });

const heartbeat = setInterval(() => log.info({ uptimeS: Math.round(process.uptime()) }, "heartbeat"), cfg.HEARTBEAT_INTERVAL_MS);

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando worker");
  clearInterval(heartbeat);
  await Promise.allSettled([queue.stop(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
