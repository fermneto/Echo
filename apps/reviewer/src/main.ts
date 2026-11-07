import { loadConfig } from "@echo/config";
import { PgBossQueue } from "@echo/jobs";
import { createLogger, initTracing } from "@echo/observability";
import { registerPing } from "./ping.ts";

const cfg = loadConfig("reviewer");
const log = createLogger("reviewer", cfg.LOG_LEVEL);
const flush = initTracing({ publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY, baseUrl: cfg.LANGFUSE_BASE_URL });
const queue = new PgBossQueue(cfg.DATABASE_URL);

await queue.start();
await registerPing(queue, (msg) => log.info({ from: msg.from, nonce: msg.nonce }, "ping recebido"));
log.info("reviewer no ar, aguardando a fila");

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando reviewer");
  await Promise.allSettled([queue.stop(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
