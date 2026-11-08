// Agenda e distribuição em Postgres real (DATABASE_URL): dias escolhidos, tarefa sem tracker e dependências gravadas.
import { randomUUID } from "node:crypto";
import { asSystem, createDb, createPool, type Database, identities, orgs, people, tasks } from "@echo/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAgentData } from "./pg-data.ts";
import { createPgWorkPlanningStore } from "./pg-work-planning.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("agenda e distribuição em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const [org, other] = [randomUUID(), randomUUID()];
  const [yan, carla, task] = [randomUUID(), randomUUID(), randomUUID()];
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Agenda" }, { id: other, name: "Outra empresa" }]);
      await tx.insert(people).values([
        { id: yan, orgId: org, name: "Yan Lemos", role: "member", timezone: "America/Fortaleza", workHours: hours },
        { id: carla, orgId: org, name: "Carla Souza", role: "member", timezone: "America/Fortaleza", workHours: hours },
      ]);
      await tx.insert(identities).values([
        { orgId: org, personId: yan, platform: "slack", externalId: `U-${org.slice(0, 8)}` },
        { orgId: org, personId: carla, platform: "linear", externalId: `lin-${org.slice(0, 8)}` },
      ]);
      await tx.insert(tasks).values({ id: task, orgId: org, key: "ECH-900", title: "Tarefa local", state: "todo", blockedBy: ["ECH-901"] });
    });
  });
  afterAll(async () => {
    if (db) await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    if (db) await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, other)));
    await pool?.end();
  });

  it("guarda os dias da pessoa, atribui a tarefa sem tracker e lê as dependências, só na própria empresa", async () => {
    const store = createPgWorkPlanningStore(db, org);
    expect(await store.pins(yan)).toEqual({});
    await store.setPins(yan, { "ECH-900": "2026-11-11" });
    expect(await store.pins(yan)).toEqual({ "ECH-900": "2026-11-11" });
    expect(await createPgWorkPlanningStore(db, other).pins(yan)).toEqual({});

    expect(await store.hasSlack(yan)).toBe(true);
    expect(await store.hasSlack(carla)).toBe(false);
    // Sem rota do Jira na empresa, vale o Linear.
    expect([...(await store.trackerAccounts())]).toEqual([carla]);
    expect((await createPgWorkPlanningStore(db, other).trackerAccounts()).size).toBe(0);

    await createPgWorkPlanningStore(db, other).assignLocalTask(task, carla);
    expect((await createPgAgentData(db, org).tasks({ openOnly: true })).find((t) => t.key === "ECH-900")?.assigneeId).toBeUndefined();
    await store.assignLocalTask(task, carla);
    const [stored] = (await createPgAgentData(db, org).tasks({ openOnly: true })).filter((t) => t.key === "ECH-900");
    expect(stored).toMatchObject({ assigneeId: carla, blockedBy: ["ECH-901"], hasLinearId: false });
  });
});
