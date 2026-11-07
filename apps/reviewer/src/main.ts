import { allOrgIds, serverFix } from "@echo/agents/server";
import { loadConfig } from "@echo/config";
import { createDb, createPool } from "@echo/db";
import { PgBossQueue } from "@echo/jobs";
import { createLogger, initTracing } from "@echo/observability";
import { registerFix } from "./fix.ts";
import { registerPing } from "./ping.ts";

const cfg = loadConfig("reviewer");
const log = createLogger("reviewer", cfg.LOG_LEVEL);
const flush = initTracing({ publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY, baseUrl: cfg.LANGFUSE_BASE_URL });
const queue = new PgBossQueue(cfg.DATABASE_URL);
const pool = createPool(cfg.DATABASE_URL);
const db = createDb(pool);

await queue.start();
await registerPing(queue, (msg) => log.info({ from: msg.from, nonce: msg.nonce }, "ping recebido"));

// Correção (etapa 10). O PR, o token de 1 h só leitura e o estado do rascunho vêm do GitHub pela frente de
// Integrações (CodeHost); até a porta existir, não há candidatos e nenhuma sessão é aberta.
const fix = serverFix(db, { apiKey: cfg.ANTHROPIC_API_KEY, agentId: cfg.FIX_AGENT_ID, environmentId: cfg.FIX_ENVIRONMENT_ID, timeoutMs: cfg.FIX_TIMEOUT_MS, codeHost: () => null });
const fixing = await registerFix(queue, { fix, orgIds: () => allOrgIds(db), timeoutMs: cfg.FIX_TIMEOUT_MS });
const runFix = () =>
  fixing.tick().then(
    (r) => (r.queued > 0 || r.ready > 0 || r.applied > 0) && log.info(r, "correções"),
    (err) => log.error({ err }, "falha na agenda da correção"),
  );
void runFix();
const fixTimer = setInterval(() => void runFix(), cfg.FIX_SCAN_MS);
log.info({ correcao: Boolean(cfg.ANTHROPIC_API_KEY && cfg.FIX_AGENT_ID && cfg.FIX_ENVIRONMENT_ID) }, "reviewer no ar, aguardando a fila");

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando reviewer");
  clearInterval(fixTimer);
  await Promise.allSettled([queue.stop(), pool.end(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
