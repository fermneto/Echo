// Ganhos contra o Postgres real (DATABASE_URL), sem modelo.
// Pronto quando: a tela Ganhos mostra totais (empresa e equipes com 3 ou mais pessoas, nunca uma pessoa).
import { randomUUID } from "node:crypto";
import { agentRuns, asSystem, createDb, createPool, type Database, fixRuns, identities, installations, orgs, people, planItems, pullRequests, questions, redistributionPlans, reviews, teams, workEvents } from "@echo/db";
import { DAY, FixedClock, type GainsBaseline, HOUR } from "@echo/domain";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGains } from "./gains.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createGithubGainsHistory, createPgGainsStore } from "./pg-gains.ts";
import { createDbRunRecorder } from "./server.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-07T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe.skipIf(!url)("ganhos em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const other = randomUUID();
  const produto = randomUUID();
  const dados = randomUUID();
  const [fernando, eduardo, carla, yan, bruno] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  const pr41 = randomUUID();
  const pr44 = randomUUID();
  const rev41 = randomUUID();
  const plan = randomUUID();

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Ganhos A", createdAt: ago(40 * DAY) }, { id: other, name: "Ganhos B" }]);
      await tx.insert(installations).values({ orgId: org, kind: "github", externalId: `inst-${org}`, createdAt: ago(20 * DAY) });
      await tx.insert(teams).values([{ id: produto, orgId: org, name: "Produto" }, { id: dados, orgId: org, name: "Dados" }]);
      const p = (id: string, name: string, teamId: string) => ({ id, orgId: org, teamId, name, role: "member", timezone: "America/Sao_Paulo", workHours: hours });
      await tx.insert(people).values([p(fernando, "Fernando", produto), p(eduardo, "Eduardo", produto), p(carla, "Carla", produto), p(yan, "Yan", dados), p(bruno, "Bruno", dados)]);
      await tx.insert(identities).values([
        { orgId: org, personId: fernando, platform: "github", externalId: "101", login: "fernando-echo-demo" },
        { orgId: org, personId: carla, platform: "github", externalId: "103", login: "Carla-Echo-Demo" },
      ]);
      // Respostas com o dono ausente (volta gravada) e uma com o dono presente.
      await tx.insert(questions).values([
        { orgId: org, askerId: eduardo, ownerId: fernando, kind: "gemeo", channel: "slack:C1", sourceRef: `g1-${org}`, state: "answered", answeredAt: ago(3 * DAY), ownerReturnsAt: ago(3 * DAY - 6 * HOUR), resolved: true },
        { orgId: org, askerId: carla, ownerId: eduardo, kind: "gemeo", channel: "slack:C1", sourceRef: `g2-${org}`, state: "answered", answeredAt: ago(2 * DAY), ownerReturnsAt: ago(2 * DAY - 2 * HOUR), resolved: false },
        { orgId: org, askerId: fernando, ownerId: carla, kind: "gemeo", channel: "slack:C1", sourceRef: `g3-${org}`, state: "answered", answeredAt: ago(DAY) },
        { orgId: other, kind: "livre", channel: "painel", sourceRef: `x-${other}`, state: "answered", answeredAt: ago(DAY), ownerReturnsAt: NOW },
      ]);
      await tx.insert(pullRequests).values([
        { id: pr41, orgId: org, repository: "teste/app", number: 41, title: "t", authorId: fernando, state: "merged", branch: "b41", openedAt: ago(5 * DAY), mergedAt: ago(3 * DAY) },
        { id: pr44, orgId: org, repository: "teste/app", number: 44, title: "t", authorId: carla, state: "open", branch: "b44", openedAt: ago(2 * DAY) },
      ]);
      const review = (ref: string, personId: string | null, prNumber: number, at: Date) => ({ orgId: org, type: "review", personId, repository: "teste/app", prNumber, occurredAt: at, source: "github", sourceRef: ref });
      await tx.insert(workEvents).values([review(`r1-${org}`, carla, 41, ago(5 * DAY - 4 * HOUR)), review(`r2-${org}`, null, 41, ago(5 * DAY - HOUR)), review(`r3-${org}`, eduardo, 44, ago(2 * DAY - 10 * HOUR))]);
      await tx.insert(reviews).values([
        { id: rev41, orgId: org, prId: pr41, headSha: "a1", state: "approved", createdAt: ago(5 * DAY - HOUR) },
        { orgId: org, prId: pr44, headSha: "b1", state: "reviewed", createdAt: ago(2 * DAY - 3 * HOUR) },
      ]);
      await tx.insert(fixRuns).values({ orgId: org, reviewId: rev41, state: "approved", createdAt: ago(4 * DAY) });
      await tx.insert(redistributionPlans).values({ id: plan, orgId: org, trigger: "vacation", options: { absentId: bruno }, state: "approved", createdAt: ago(6 * DAY), approvedAt: ago(6 * DAY - 3 * HOUR) });
      await tx.insert(planItems).values([
        { orgId: org, planId: plan, fromId: bruno, toId: yan, state: "done" },
        { orgId: org, planId: plan, fromId: bruno, toId: carla, state: "approved" },
        { orgId: org, planId: plan, fromId: bruno, state: "refused" },
      ]);
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  const flow = () => createGains({ data: (o) => createPgAgentData(db, o), store: (o) => createPgGainsStore(db, o), recorder: createDbRunRecorder(db), clock: new FixedClock(NOW) });

  it("referência: 90 dias do GitHub antes da instalação, logins ligados às pessoas, medida uma vez", async () => {
    const start = ago(20 * DAY);
    const calls: { repo: string; from: Date; to: Date }[] = [];
    const host = {
      listRepositories: async () => ["teste/app"],
      listPullRequestHistory: async (repo: string, from: Date, to: Date) => {
        calls.push({ repo, from, to });
        const opened = new Date(start.getTime() - 30 * DAY);
        return [
          { authorLogin: "fernando-echo-demo", openedAt: opened, mergedAt: new Date(opened.getTime() + 3 * DAY), reviews: [{ login: "carla-echo-demo", isBot: false, at: new Date(opened.getTime() + 30 * HOUR) }, { login: "echo-bot", isBot: true, at: new Date(opened.getTime() + HOUR) }] },
          { authorLogin: "desconhecido", openedAt: opened, reviews: [] },
        ];
      },
    };
    const r = await flow().captureBaseline(org, createGithubGainsHistory(db, org, host));
    expect(r.status).toBe("captured");
    expect(calls).toEqual([{ repo: "teste/app", from: new Date(start.getTime() - 90 * DAY), to: start }]);
    const [o] = await asSystem(db, (tx) => tx.select({ b: orgs.gainsBaseline }).from(orgs).where(eq(orgs.id, org)));
    const b = o!.b as GainsBaseline;
    expect(b.org).toEqual({ prs: 1, firstReviewHours: 30, reviewRoundsPerPr: 1 });
    expect(Object.keys(b.teams)).toEqual([produto]); // Dados tem 2 pessoas

    expect(await flow().captureBaseline(org, createGithubGainsHistory(db, org, host))).toEqual({ status: "skipped", reason: "referência já medida" });
    expect(calls).toHaveLength(1);
    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((x) => [x.flow, x.result]).sort()).toEqual([["gains_baseline", "ok"], ["gains_baseline", "skipped"]]);
  });

  it("totais da empresa e de Produto; Dados (2 pessoas) sem números; nada de outra empresa", async () => {
    const v = await flow().get(org);
    expect(v.org).toMatchObject({
      status: "ok",
      people: 5,
      waitAvoided: { hours: 8, answers: 2 },
      resolved: { yes: 1, no: 1, unrated: 1 },
      firstReview: { hours: 7, before: 30, prs: 2 }, // 4 h (Carla no PR 41; a conta sem pessoa não conta) e 10 h
      reviewRounds: { perPr: 1, before: 1, prs: 1 },
      firstAnalysis: { hours: 2, prs: 2 },
      fixes: { prepared: 1, approved: 1 },
      coverage: { tasks: 2, approvalHours: 3, plans: 1 },
    });
    expect(v.teams.map((t) => [t.name, t.result.status])).toEqual([
      ["Dados", "too_small"],
      ["Produto", "ok"],
    ]);
    const produtoTotals = v.teams.find((t) => t.id === produto)!.result;
    expect(produtoTotals).toMatchObject({ status: "ok", cost: null, coverage: { tasks: 0 } }); // Bruno é de Dados
    for (const id of [fernando, eduardo, carla, yan, bruno]) expect(JSON.stringify(v)).not.toContain(id);

    const outra = await flow().get(other);
    expect(outra.org).toMatchObject({ status: "too_small", people: 0 });
  });
});
