// Fluxo de resposta contra o Postgres real (DATABASE_URL), depois de `pnpm db:migrate`. Sem modelo: por regra.
import { randomUUID } from "node:crypto";
import { agentRuns, asSystem, createDb, createPool, dailyNotes, type Database, expertiseOverrides, orgs, people, pullRequests, tasks, teams, workEvents } from "@echo/db";
import { FixedClock } from "@echo/domain";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAnswer } from "./answer.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createDbRunRecorder, serverAnswerDeps } from "./server.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-07T14:00:00Z");

describe.skipIf(!url)("answer em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const other = randomUUID();
  const team = randomUUID();
  const fernando = randomUUID();
  const eduardo = randomUUID();
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Resposta A", repositoriesOpenToTeam: ["teste/app"] }, { id: other, name: "Resposta B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto", loadLimit: 10 });
      await tx.insert(people).values([
        { id: fernando, orgId: org, teamId: team, name: "Fernando Neto", role: "member", timezone: "America/Fortaleza", workHours: hours },
        { id: eduardo, orgId: org, teamId: team, name: "Eduardo", role: "member", timezone: "Africa/Johannesburg", workHours: hours },
      ]);
      await tx.insert(dailyNotes).values({
        orgId: org,
        personId: fernando,
        date: "2026-11-06",
        released: [{ branch: "ech-131-api-v2", to: eduardo }],
        reserved: [{ branch: "ech-128-tempo-limite", reason: "Até a revisão do PR sair." }],
        state: "confirmed",
        confirmedAt: new Date("2026-11-06T21:00:00Z"),
      });
      await tx.insert(tasks).values({ orgId: org, key: "ECH-128", title: "Tempo limite", assigneeId: fernando, state: "in_progress", linearId: "lin-1" });
      await tx.insert(pullRequests).values({ orgId: org, repository: "teste/app", number: 44, title: "Tempo limite", authorId: fernando, state: "open", branch: "ech-128-tempo-limite", taskKey: "ECH-128" });
      await tx.insert(workEvents).values({ orgId: org, type: "commit", personId: fernando, repository: "teste/app", branch: "ech-128-tempo-limite", occurredAt: new Date("2026-11-06T20:00:00Z"), source: "github", sourceRef: `commit:${randomUUID()}` });
      await tx.insert(expertiseOverrides).values({ orgId: org, personId: eduardo, topic: "kubernetes", include: true });
      await tx.insert(agentRuns).values({ orgId: org, flow: "answer", durationMs: 1, result: "ok", costUsd: "1.250000", createdAt: new Date("2026-11-02T00:00:00Z") });
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  it("lê os dados da empresa, e só dela", async () => {
    const data = createPgAgentData(db, org);
    expect((await data.orgSettings()).teamLoadLimits).toEqual({ [team]: 10 });
    expect((await data.people()).map((p) => p.name).sort()).toEqual(["Eduardo", "Fernando Neto"]);
    expect((await data.latestDailyNote(fernando))?.released).toEqual([{ branch: "ech-131-api-v2", to: eduardo }]);
    expect((await data.task("ech-128"))?.state).toBe("in_progress");
    expect((await data.pullRequests({ branch: "ech-128-tempo-limite" })).map((p) => p.number)).toEqual([44]);
    expect(await data.lastCommitAt("teste/app", "ech-128-tempo-limite")).toEqual(new Date("2026-11-06T20:00:00Z"));
    expect(await data.spentUsdSince(new Date("2026-11-01T00:00:00Z"))).toBeCloseTo(1.25);

    expect(await data.expertiseOverrides()).toEqual([{ personId: eduardo, topic: "kubernetes", include: true }]);

    const outsider = createPgAgentData(db, other);
    expect(await outsider.people()).toEqual([]);
    expect(await outsider.latestDailyNote(fernando)).toBeNull();
    expect(await outsider.pullRequests({})).toEqual([]);
    expect(await outsider.expertiseOverrides()).toEqual([]);
  });

  it("responde por regra com fontes e grava agent_runs na empresa", async () => {
    const answer = createAnswer({ ...serverAnswerDeps(db, undefined), clock: new FixedClock(NOW) });
    const r = await answer({ orgId: org, askerId: eduardo, ownerId: fernando, text: "@Fernando e a ech-128-tempo-limite, posso mexer?", channel: "painel" });
    expect(r.agentName).toBe("Agente de Fernando");
    expect(r.text).toMatch(/^A ech-128-tempo-limite está reservada por Fernando: Até a revisão do PR sair\./);
    expect(r.sources.map((s) => s.ref)).toEqual([`daily_note:${fernando}:2026-11-06`, "github:pr/44"]);
    expect(r.needsOwner).toBe(true);

    const released = await answer({ orgId: org, askerId: eduardo, ownerId: fernando, text: "a ech-131-api-v2 está liberada?", channel: "painel" });
    expect(released.text).toMatch(/está liberada para Eduardo/);

    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    const fallbacks = runs.filter((x) => x.result === "fallback");
    expect(fallbacks).toHaveLength(2);
    expect(fallbacks[0]).toMatchObject({ flow: "answer", model: null, costUsd: null });
    expect(fallbacks.flatMap((x) => x.tools)).toEqual([]);
  });

  it("quem sabe por regra lê a evidência do banco e grava agent_runs como quem_sabe", async () => {
    const answer = createAnswer({ ...serverAnswerDeps(db, undefined), clock: new FixedClock(NOW) });
    const r = await answer({ orgId: org, askerId: fernando, text: "alguém sabe de kubernetes?", channel: "slack" });
    expect(r.kind).toBe("quem_sabe");
    expect(r.text).toBe(["Quem tem registro sobre kubernetes:", "- Eduardo: ajuste de Eduardo", "A ordem vale só para esta pergunta."].join("\n"));
    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.filter((x) => x.flow === "quem_sabe")).toHaveLength(1);
  });

  it("o gravador recusa execução sem empresa", async () => {
    await expect(createDbRunRecorder(db).record({ flow: "answer", durationMs: 1, result: "ok" })).rejects.toThrow(/sem empresa/);
  });
});
