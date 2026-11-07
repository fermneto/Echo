import { createDb, createPool } from "@echo/db";
import { LogRunRecorder } from "@echo/observability";
import { pino } from "pino";
import { afterAll, describe, expect, it } from "vitest";
import { reconcileOnce } from "./reconcile.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("reconcileOnce", () => {
  const pool = createPool(url!, 3);
  const deps = { db: createDb(pool), pool, platforms: {}, runs: new LogRunRecorder(), log: pino({ level: "silent" }) };
  afterAll(() => pool.end());

  it("roda quando ninguém mais está reconciliando", async () => {
    expect(await reconcileOnce(deps)).toEqual({ skipped: false });
  });

  it("pula a rodada se outro worker já tem a trava", async () => {
    const other = await pool.connect();
    await other.query("select pg_advisory_lock($1)", [41_2026_11]);
    try {
      expect(await reconcileOnce(deps)).toEqual({ skipped: true });
    } finally {
      await other.query("select pg_advisory_unlock($1)", [41_2026_11]);
      other.release();
    }
    expect(await reconcileOnce(deps)).toEqual({ skipped: false });
  });
});
