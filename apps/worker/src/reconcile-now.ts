// Roda uma rodada de reconciliação na hora (teste real das integrações).
// Uso: pnpm integracoes:reconciliar
import { loadConfig } from "@echo/config";
import { platformsFromEnv } from "@echo/connectors";
import { createDb, createPool } from "@echo/db";
import { createLogger, LogRunRecorder } from "@echo/observability";
import { reconcileOnce } from "./reconcile.ts";

const cfg = loadConfig("worker");
const log = createLogger("reconcile", cfg.LOG_LEVEL);
const pool = createPool(cfg.DATABASE_URL, 3);
const runs = new LogRunRecorder();
const platforms = platformsFromEnv(cfg);
if (!platforms.github && !platforms.linear) console.log("Nem GitHub nem Linear configurados no .env: nada a reconciliar (ver docs/teste-integracoes.md).");
const r = await reconcileOnce({ db: createDb(pool), pool, platforms, runs, log, brainsRepository: cfg.BRAINS_REPOSITORY });
if (r.skipped) console.log("Outro worker está reconciliando agora; tente de novo em instantes.");
for (const run of runs.runs) console.log(`${run.flow.padEnd(20)} ${run.result.padEnd(7)} ${run.durationMs} ms${run.error ? ` · ${run.error}` : ""}`);
await pool.end();
