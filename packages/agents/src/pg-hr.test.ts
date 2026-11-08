// Visão das equipes do RH contra o Postgres real (DATABASE_URL), com papel comum (RLS): só enviados, só equipes
// pedidas, ausência em curso e isolamento entre empresas.
import { randomUUID } from "node:crypto";
import { absences, asSystem, createDb, createPool, type Database, orgs, people, questions, tasks, teams, weeklyReports } from "@echo/db";
import { appRoleUrl } from "@echo/db/testing";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readHrOverview } from "./pg-hr.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-08T12:00:00Z");

describe.skipIf(!url)("visão das equipes em Postgres", () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let db: Database;
  const [org, other, team, small] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [a, b, c, d] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const sys = () => createDb(admin);
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  const period = { from: "2026-10-26T03:00:00.000Z", to: "2026-10-31T03:00:00.000Z" };
  const metrics = (deliveries: number, reviews: number, helps: number) => ({ deliveries, commits: 0, reviews, helps, delays: [], deliveryRefs: [], helped: [] });

  beforeAll(async () => {
    admin = createPool(url!, 2, { defaultScope: "none" });
    await asSystem(sys(), async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "RH A" }, { id: other, name: "RH B" }]);
      await tx.insert(teams).values([{ id: team, orgId: org, name: "Produto" }, { id: small, orgId: org, name: "Dupla" }]);
      const p = (id: string, name: string, teamId: string) => ({ id, orgId: org, teamId, name, role: "member", timezone: "America/Sao_Paulo", workHours: hours });
      await tx.insert(people).values([p(a, "Ana Teste", team), p(b, "Beto Teste", team), p(c, "Caio Teste", team), p(d, "Dora Teste", small)]);
      await tx.insert(weeklyReports).values([
        { orgId: org, personId: a, week: "2026-W44", metrics: metrics(2, 1, 1), state: "sent", coveredPeriod: period },
        { orgId: org, personId: b, week: "2026-W44", metrics: metrics(1, 2, 0), state: "sent", coveredPeriod: period },
        { orgId: org, personId: c, week: "2026-W44", metrics: metrics(5, 5, 5), state: "awaiting_owner", coveredPeriod: period },
      ]);
      await tx.insert(questions).values([
        { orgId: org, askerId: b, ownerId: a, kind: "gemeo", channel: "slack:C1", sourceRef: `hr:${org}:1`, state: "answered", answeredAt: new Date("2026-11-03T15:00:00Z") },
        { orgId: org, askerId: b, ownerId: a, kind: "gemeo", channel: "slack:C1", sourceRef: `hr:${org}:2`, state: "failed" },
      ]);
      const t = (key: string, assigneeId: string, state: string, size: number, at: string) => ({ orgId: org, key, title: key, assigneeId, state, size, externalUpdatedAt: new Date(at) });
      await tx.insert(tasks).values([
        t("P-1", a, "done", 3, "2026-11-04T12:00:00Z"),
        t("P-2", b, "done", 5, "2026-10-01T12:00:00Z"), // concluída há mais de 2 semanas: fora
        t("P-3", b, "in_review", 2, "2026-11-07T12:00:00Z"),
        t("P-4", c, "todo", 1, "2026-11-07T12:00:00Z"),
        t("P-5", c, "canceled", 8, "2026-11-07T12:00:00Z"),
        t("P-6", d, "done", 8, "2026-11-07T12:00:00Z"), // outra equipe
      ]);
      await tx.insert(absences).values({ orgId: org, personId: c, kind: "vacation", startsAt: new Date("2026-11-05T00:00:00Z"), endsAt: new Date("2026-11-14T00:00:00Z"), source: "hr" });
    });
    app = createPool(await appRoleUrl(admin, url!), 2, { defaultScope: "none" });
    db = createDb(app);
  });

  afterAll(async () => {
    await asSystem(sys(), (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await asSystem(sys(), (tx) => tx.delete(orgs).where(eq(orgs.id, other)));
    await app.end();
    await admin.end();
  });

  it("totais da equipe com os enviados; equipe pequena sem números; outra empresa não vê nada", async () => {
    const v = await readHrOverview(db, org, [team, small], NOW, "America/Sao_Paulo");
    expect(v.weeks.at(-1)).toBe("2026-W45");
    expect(v.focus).toBe("2026-W44");
    const dupla = v.teams.find((t) => t.id === small);
    expect(dupla).toMatchObject({ status: "too_small", people: 1 });
    const produto = v.teams.find((t) => t.id === team);
    if (produto?.status !== "ok") throw new Error("esperava totais");
    expect(produto.weeks.find((w) => w.week === "2026-W44")).toMatchObject({ deliveries: 3, reviews: 3, helps: 1, sent: 2 });
    expect(produto.weeks.find((w) => w.week === "2026-W45")).toMatchObject({ twins: 1, sent: 0 });
    expect(produto.progress).toEqual({ done: 1, review: 1, doing: 0, todo: 1, total: 3, points: { done: 3, total: 6 }, percent: 50 });
    expect(produto.away).toEqual([{ name: "Caio Teste", kind: "vacation", until: new Date("2026-11-14T00:00:00Z") }]);

    expect((await readHrOverview(db, org, [small], NOW)).teams.map((t) => t.id)).toEqual([small]);
    expect((await readHrOverview(db, other, [team, small], NOW)).teams).toEqual([]);
    expect((await readHrOverview(db, org, [], NOW)).teams).toEqual([]);
  });
});
