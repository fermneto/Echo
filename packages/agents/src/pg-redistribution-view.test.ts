// Leitura da Redistribuição para o painel, contra o Postgres real (DATABASE_URL). Tudo roda numa transação
// desfeita no fim: nenhuma linha fica no banco.
import { randomUUID } from "node:crypto";
import { createPgOutbox } from "@echo/actions/pg";
import { createDb, createPool, type Database, identities, orgs, people, pullRequests, tasks, teams } from "@echo/db";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { createPgAgentData } from "./pg-data.ts";
import { createPgRedistributionStore } from "./pg-redistribution.ts";
import { awaitingPlansFor, readRedistributionPanel } from "./pg-redistribution-view.ts";
import { createRedistribution } from "./redistribution.ts";
import { createDbRunRecorder } from "./server.ts";

const url = process.env.DATABASE_URL;
const ROLLBACK = "desfazer";

it.skipIf(!url)("painel: plano esperando a liderança, com rótulos e carga; depois da aprovação, o estado real", async () => {
  const pool = createPool(url!, 1, { defaultScope: "none" });
  const base = createDb(pool);
  const [org, team] = [randomUUID(), randomUUID()];
  const [bruno, carla, marina, yan] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  try {
    await base.transaction(async (outer) => {
      await outer.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
      await outer.insert(orgs).values({ id: org, name: "Painel da redistribuição" });
      await outer.insert(teams).values({ id: team, orgId: org, name: "Produto", loadLimit: 12, leaderId: marina });
      await outer.insert(people).values([
        { id: bruno, orgId: org, teamId: team, name: "Bruno Lima", role: "member", timezone: "America/Fortaleza", workHours: hours, areas: ["pagamentos"] },
        { id: carla, orgId: org, teamId: team, name: "Carla Souza", role: "member", timezone: "America/Fortaleza", workHours: hours, areas: ["pagamentos"] },
        { id: marina, orgId: org, teamId: team, name: "Marina Alves", role: "leader", timezone: "America/Fortaleza", workHours: hours },
        { id: yan, orgId: org, teamId: team, name: "Yan", role: "member", timezone: "Asia/Tokyo", workHours: hours },
      ]);
      await outer.insert(identities).values([carla, marina, yan].map((p) => ({ orgId: org, personId: p, platform: "linear", externalId: `lin-${p}` })));
      await outer.insert(tasks).values([
        { orgId: org, key: "ECH-133", linearId: "lin-133", title: "Estorno parcial", assigneeId: bruno, state: "todo", size: 3, area: "pagamentos" },
        { orgId: org, key: "ECH-135", title: "Webhook do gateway", assigneeId: carla, state: "in_progress", size: 2, area: "pagamentos" },
      ]);
      await outer.insert(pullRequests).values({ orgId: org, repository: "teste/app", number: 36, title: "Fila de webhooks", authorId: yan, state: "open", branch: "ech-130-fila", reviewerIds: [bruno] });

      const db = outer as unknown as Database;
      const flow = createRedistribution({ data: (o) => createPgAgentData(db, o), store: (o) => createPgRedistributionStore(db, o), outbox: (o) => createPgOutbox(db, o), recorder: createDbRunRecorder(db), webUrl: "http://localhost:3000" });
      const now = new Date();
      const day = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10);

      const empty = await readRedistributionPanel(db, org, marina, now);
      expect(empty.plans).toEqual([]);
      expect(empty.people.map((p) => p.name).sort()).toEqual(["Bruno Lima", "Carla Souza", "Yan"]);

      const reg = await flow.registerAbsence(org, marina, { personId: bruno, startDate: day(3), endDate: day(10), kind: "vacation" });
      expect(reg.status).toBe("registered");
      expect((await flow.propose(org, reg.status === "registered" ? reg.absenceId : "")).status).toBe("created");

      const panel = await readRedistributionPanel(db, org, marina, now);
      expect(panel.plans).toHaveLength(1);
      const plan = panel.plans[0]!;
      expect(plan).toMatchObject({ state: "awaiting_leader", trigger: "vacation", absentName: "Bruno" });
      expect(plan.title).toMatch(/^Plano para as férias de Bruno/);
      const task = plan.items.find((i) => i.label === "ECH-133")!;
      expect(task).toMatchObject({ kind: "task", title: "Estorno parcial", toName: "Carla", state: "proposed", reason: "Atua em pagamentos e tem folga." });
      expect(task.load).toEqual({ load: 2, limit: 12 }); // ECH-135, de 2 pontos, antes de receber
      const review = plan.items.find((i) => i.kind === "review")!;
      expect(review).toMatchObject({ label: "PR 36", title: "Revisão do PR 36" });
      expect(review.toName).not.toBe("Yan"); // autor do PR não revisa

      expect(await awaitingPlansFor(db, org, marina, now)).toEqual([{ id: plan.id, title: plan.title, createdAt: plan.createdAt, items: plan.items.length }]);
      // Só a liderança da equipe vê o plano.
      expect((await readRedistributionPanel(db, org, carla, now)).plans).toEqual([]);
      expect(await awaitingPlansFor(db, org, carla, now)).toEqual([]);

      expect((await flow.approve(org, marina, plan.id, { exclude: [review.id] })).status).toBe("ok");
      const after = (await readRedistributionPanel(db, org, marina, new Date())).plans[0]!;
      expect(after).toMatchObject({ state: "executing", approvedByName: "Marina" });
      expect(after.decidedAt).toBeInstanceOf(Date);
      expect(after.items.find((i) => i.id === review.id)!.state).toBe("excluded");
      expect(after.items.find((i) => i.id === task.id)!.state).toBe("approved");
      expect(await awaitingPlansFor(db, org, marina, new Date())).toEqual([]);
      throw new Error(ROLLBACK);
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
  } finally {
    await pool.end();
  }
}, 30_000);
