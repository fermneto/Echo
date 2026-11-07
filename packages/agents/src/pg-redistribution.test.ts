// Redistribuição contra o Postgres real (DATABASE_URL). Pronto quando: férias registradas geram plano por regra
// para a liderança; nada muda antes da aprovação; aprovado, as mudanças entram no outbox com a aprovação dela.
import { randomUUID } from "node:crypto";
import { createPgOutbox } from "@echo/actions/pg";
import { absences, agentRuns, asSystem, createDb, createPool, type Database, identities, orgs, outboxActions, people, planItems, pullRequests, redistributionPlans, tasks, teams } from "@echo/db";
import { FixedClock } from "@echo/domain";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAgentData } from "./pg-data.ts";
import { createPgRedistributionStore } from "./pg-redistribution.ts";
import { createRedistribution } from "./redistribution.ts";
import { createDbRunRecorder } from "./server.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-09T13:00:00Z");

describe.skipIf(!url)("redistribuição em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const other = randomUUID();
  const team = randomUUID();
  const [bruno, carla, marina, yan] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [t133, t137] = [randomUUID(), randomUUID()];
  const pr36 = randomUUID();
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Redistribuição A" }, { id: other, name: "Redistribuição B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto", loadLimit: 12, leaderId: marina });
      await tx.insert(people).values([
        { id: bruno, orgId: org, teamId: team, name: "Bruno Lima", role: "member", timezone: "America/Fortaleza", workHours: hours, areas: ["pagamentos"] },
        { id: carla, orgId: org, teamId: team, name: "Carla Souza", role: "member", timezone: "America/Fortaleza", workHours: hours, areas: ["pagamentos"] },
        { id: marina, orgId: org, teamId: team, name: "Marina Alves", role: "leader", timezone: "America/Fortaleza", workHours: hours },
        { id: yan, orgId: org, teamId: team, name: "Yan", role: "member", timezone: "Asia/Tokyo", workHours: hours },
      ]);
      await tx.insert(identities).values([carla, marina, yan].map((p) => ({ orgId: org, personId: p, platform: "linear", externalId: `lin-${p}` })));
      await tx.insert(tasks).values([
        { id: t133, orgId: org, key: "ECH-133", linearId: "lin-133", title: "Estorno parcial", assigneeId: bruno, state: "todo", size: 3, area: "pagamentos", dueDate: "2026-11-12" },
        { id: t137, orgId: org, key: "ECH-137", title: "Texto do recibo", assigneeId: bruno, state: "todo", size: 2 },
      ]);
      await tx.insert(pullRequests).values({ id: pr36, orgId: org, repository: "teste/app", number: 36, title: "Fila de webhooks", authorId: yan, state: "open", branch: "ech-130-fila", reviewerIds: [bruno] });
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  it("férias no painel → plano para a liderança → aprovação → outbox → concluído", async () => {
    const flow = createRedistribution({
      data: (o) => createPgAgentData(db, o),
      store: (o) => createPgRedistributionStore(db, o),
      outbox: (o) => createPgOutbox(db, o),
      recorder: createDbRunRecorder(db),
      clock: new FixedClock(NOW),
      webUrl: "http://localhost:3000",
    });

    expect(await flow.registerAbsence(org, carla, { personId: bruno, startDate: "2026-11-10", endDate: "2026-11-21", kind: "vacation" })).toEqual({ status: "denied" });
    const reg = await flow.registerAbsence(org, bruno, { personId: bruno, startDate: "2026-11-10", endDate: "2026-11-21", kind: "vacation" });
    expect(reg.status).toBe("registered");
    const absenceId = reg.status === "registered" ? reg.absenceId : "";
    const [abs] = await asSystem(db, (tx) => tx.select().from(absences).where(eq(absences.id, absenceId)));
    expect(abs).toMatchObject({ source: "panel", startsAt: new Date("2026-11-10T03:00:00Z"), endsAt: new Date("2026-11-22T03:00:00Z") });

    const p = await flow.propose(org, absenceId);
    expect(p.status).toBe("created");
    const planId = p.status === "created" ? p.plan.id : "";
    expect((await flow.propose(org, absenceId)).status).toBe("skipped");

    const [planRow] = await asSystem(db, (tx) => tx.select().from(redistributionPlans).where(eq(redistributionPlans.id, planId)));
    expect(planRow).toMatchObject({ orgId: org, trigger: "vacation", absenceId, state: "awaiting_leader", options: { absentId: bruno } });
    const items = await asSystem(db, (tx) => tx.select().from(planItems).where(eq(planItems.planId, planId)));
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.state === "proposed" && i.fromId === bruno && i.toId && i.reason)).toBe(true);
    expect(items.find((i) => i.prId === pr36)!.toId).not.toBe(yan); // autor do PR não revisa
    const before = await asSystem(db, (tx) => tx.select().from(outboxActions).where(eq(outboxActions.orgId, org)));
    expect(before.map((a) => [a.type, a.state, (a.payload as { personId: string }).personId])).toEqual([["slack.dm", "pending", marina]]);
    const [unchanged] = await asSystem(db, (tx) => tx.select().from(tasks).where(eq(tasks.id, t137)));
    expect(unchanged!.assigneeId).toBe(bruno);

    // Outra empresa não vê nem aprova.
    expect(await createPgRedistributionStore(db, other).get(planId)).toBeNull();
    expect(await flow.approve(other, marina, planId)).toEqual({ status: "not_found" });
    expect(await flow.approve(org, carla, planId)).toEqual({ status: "denied" });

    const r = await flow.approve(org, marina, planId);
    expect(r.status).toBe("ok");
    const actions = await asSystem(db, (tx) => tx.select().from(outboxActions).where(and(eq(outboxActions.orgId, org))));
    const approved = actions.filter((a) => a.approvedBy === marina);
    expect(approved.map((a) => a.type).sort()).toEqual(["github.set_reviewers", "linear.assign", "linear.comment"]);
    expect(approved.every((a) => a.state === "approved")).toBe(true);
    const assign = approved.find((a) => a.type === "linear.assign")!;
    const i133 = items.find((i) => i.taskId === t133)!;
    expect(assign.payload).toEqual({ taskKey: "ECH-133", toPersonId: i133.toId, planItemId: i133.id });
    // ECH-137 não existe no Linear: muda no Echo, depois da aprovação.
    const i137 = items.find((i) => i.taskId === t137)!;
    const [moved] = await asSystem(db, (tx) => tx.select().from(tasks).where(eq(tasks.id, t137)));
    expect(moved!.assigneeId).toBe(i137.toId);

    // O executor (Integrações) marca os itens pelo planItemId; a passada conclui o plano e avisa a liderança.
    await asSystem(db, (tx) => tx.update(planItems).set({ state: "done" }).where(and(eq(planItems.planId, planId), eq(planItems.state, "approved"))));
    expect(await flow.sync(org)).toEqual({ done: 1 });
    const [done] = await asSystem(db, (tx) => tx.select().from(redistributionPlans).where(eq(redistributionPlans.id, planId)));
    expect(done).toMatchObject({ state: "done", approvedBy: marina });

    // Recusa com motivo: guardada, sem ir para a mensagem da liderança.
    const refuser = i133.toId!;
    expect(await flow.refuse(org, refuser, i133.id, "Estou na entrega do checkout")).toEqual({ status: "refused" });
    const [refused] = await asSystem(db, (tx) => tx.select().from(planItems).where(eq(planItems.id, i133.id)));
    expect(refused).toMatchObject({ state: "refused", refusal: "Estou na entrega do checkout" });
    const [again] = await asSystem(db, (tx) => tx.select().from(redistributionPlans).where(eq(redistributionPlans.id, planId)));
    expect(again!.state).toBe("executing");

    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((x) => x.flow).sort()).toEqual(["redistribution_approve", "redistribution_approve", "redistribution_done", "redistribution_plan", "redistribution_plan", "redistribution_refuse"]);
    expect(runs.filter((x) => x.flow === "redistribution_approve").map((x) => x.result).sort()).toEqual(["ok", "refused"]);
    expect(runs.every((x) => x.model === null)).toBe(true);
  });
});
