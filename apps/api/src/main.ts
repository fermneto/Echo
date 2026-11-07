import { serve } from "@hono/node-server";
import { listenPort, loadConfig } from "@echo/config";
import { createPool, ping } from "@echo/db";
import { createLogger, initTracing } from "@echo/observability";
import { createApp } from "./app.ts";

const cfg = loadConfig("api");
const log = createLogger("api", cfg.LOG_LEVEL);
const flush = initTracing({ publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY, baseUrl: cfg.LANGFUSE_BASE_URL });
const pool = createPool(cfg.DATABASE_URL);

const app = createApp({ ready: () => ping(pool), version: process.env.RENDER_GIT_COMMIT?.slice(0, 7) });
const port = listenPort(cfg);
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => log.info({ port: info.port }, "api no ar"));

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando api");
  server.close();
  await Promise.allSettled([pool.end(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
