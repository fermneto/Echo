// Execuções do worker em agent_runs (Postgres real): o registrador e a ingestão, que só grava o que teve efeito.
import { receive } from "@echo/connectors";
import { agentRuns, asSystem, createDb, createPool, orgs } from "@echo/db";
import { InMemoryQueue } from "@echo/jobs";
import { eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerInbox } from "./inbox.ts";
import { createWorkerRunRecorder } from "./runs.ts";

const url = process.env.DATABASE_URL;

/** Log em memória, para conferir o que foi para o log. */
function memoryLog() {
  const lines: { level: number; msg: string; [k: string]: unknown }[] = [];
  const log = pino({ level: "info" }, { write: (s: string) => void lines.push(JSON.parse(s)) });
  return { log, lines };
}

describe.skipIf(!url)("execuções do worker em agent_runs", () => {
  const pool = createPool(url!, 3);
  const db = createDb(pool);
  const suffix = Math.random().toString(36).slice(2, 8);
  let orgId = "";
  const rowsOf = () => asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, orgId)));

  beforeAll(async () => {
    orgId = await asSystem(db, async (tx) => (await tx.insert(orgs).values({ name: `Execuções worker ${suffix}` }).returning())[0]!.id);
  });
  afterAll(async () => {
    await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, orgId)));
    await pool.end();
  });

  it("grava a execução com empresa em agent_runs e também no log", async () => {
    const { log, lines } = memoryLog();
    const runs = createWorkerRunRecorder(db, log);
    await runs.record({ flow: "reconcile_github", orgId, durationMs: 12, result: "failed", error: "GitHub fora do ar" });
    expect(await rowsOf()).toMatchObject([{ flow: "reconcile_github", durationMs: 12, result: "failed", error: "GitHub fora do ar" }]);
    expect(lines.filter((l) => l.msg === "agent_run")).toHaveLength(1);
  });

  it("sem empresa, fica só no log (o RLS não deixa gravar) e não lança", async () => {
    const { log, lines } = memoryLog();
    let stored = 0;
    const runs = createWorkerRunRecorder(db, log, { record: async () => void stored++ });
    await runs.record({ flow: "reconcile_redeliver", durationMs: 3, result: "ok" });
    expect(stored).toBe(0);
    expect(lines.filter((l) => l.msg === "agent_run")).toHaveLength(1);
  });

  it("falha ao gravar a linha não derruba o fluxo: vira erro no log", async () => {
    const { log, lines } = memoryLog();
    const runs = createWorkerRunRecorder(db, log, { record: async () => Promise.reject(new Error("banco fora")) });
    await expect(runs.record({ flow: "actions", orgId, durationMs: 1, result: "ok" })).resolves.toBeUndefined();
    expect(lines.find((l) => l.msg === "falha ao gravar em agent_runs")).toMatchObject({ flow: "actions", orgId, err: "Error: banco fora" });
  });

  it("ingestão: aviso com efeito vira linha; aviso só ignorado não", async () => {
    await asSystem(db, (tx) => tx.delete(agentRuns).where(eq(agentRuns.orgId, orgId)));
    const queue = new InMemoryQueue();
    await registerInbox(db, queue, createWorkerRunRecorder(db, pino({ level: "silent" })), { slackBotUserId: "UBOT" });
    const envelope = (event: Record<string, unknown>, id: string) => ({ type: "event_callback", team_id: "T-DEMO", event_id: id, event });

    // Menção ao agente: segue para o F2.
    await receive(db, queue, { source: "slack", orgId, deliveryId: `runs-${suffix}-1`, payload: envelope({ type: "app_mention", text: "<@UBOT> quem está livre?", user: "UQUALQUER", channel: "C1", ts: "1.1" }, "Ev1") });
    // Evento que o Echo não usa: só ignorado.
    await receive(db, queue, { source: "slack", orgId, deliveryId: `runs-${suffix}-2`, payload: envelope({ type: "user_change", user: { id: "UQUALQUER" } }, "Ev2") });

    expect((await rowsOf()).map((r) => [r.flow, r.result])).toEqual([["inbox", "ok"]]);
  });
});
