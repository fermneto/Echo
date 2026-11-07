// Correção contra o Postgres real (DATABASE_URL), com o ambiente e o GitHub simulados.
// Pronto quando: um erro plantado gera uma correção aprovável, unida pela aprovação do autor.
import { randomUUID } from "node:crypto";
import { createPgOutbox } from "@echo/actions/pg";
import { agentRuns, asSystem, createDb, createPool, type Database, fixRuns, orgs, outboxActions, people, pullRequests, reviews, teams } from "@echo/db";
import { FixedClock, type PullHead } from "@echo/domain";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFix } from "./fix.ts";
import { createMorningPlan } from "./morning-plan.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createPgFixStore } from "./pg-fix.ts";
import { createPgPlanStore } from "./pg-night.ts";
import { createDbRunRecorder } from "./server.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-09T06:00:00Z");
const PATCH = ["diff --git a/src/filtros.ts b/src/filtros.ts", "--- a/src/filtros.ts", "+++ b/src/filtros.ts", "@@ -1 +1 @@", "-db.query(`... '${filtro}'`)", "+db.query('... $1', [filtro])"].join("\n");

describe.skipIf(!url)("correção em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const other = randomUUID();
  const team = randomUUID();
  const fernando = randomUUID();
  const eduardo = randomUUID();
  const pr44 = randomUUID();
  const review = randomUUID();
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Correção A" }, { id: other, name: "Correção B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto", loadLimit: 10 });
      await tx.insert(people).values([
        { id: fernando, orgId: org, teamId: team, name: "Fernando Neto", role: "member", timezone: "America/Fortaleza", workHours: hours },
        { id: eduardo, orgId: org, teamId: team, name: "Eduardo", role: "member", timezone: "Africa/Johannesburg", workHours: hours },
      ]);
      await tx.insert(pullRequests).values({ id: pr44, orgId: org, repository: "teste/app", number: 44, title: "Filtro da listagem", authorId: fernando, state: "open", branch: "ech-128-filtro", headSha: "sha44" });
      await tx.insert(reviews).values({
        id: review,
        orgId: org,
        prId: pr44,
        headSha: "sha44",
        state: "reviewed",
        model: "claude-sonnet-5-5",
        files: ["src/filtros.ts"],
        findings: [{ arquivo: "src/filtros.ts", linha: 1, gravidade: "alta", explicacao: "SQL concatenada.", sugestao: "Parametrizar.", confianca: 0.95 }],
      });
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  it("achado → rascunho pelo outbox → pronta no plano → aprovada pelo autor → aplicada", async () => {
    const pulls = new Map<number, PullHead>([[44, { state: "open", headSha: "sha44" }]]);
    const fix = createFix({
      data: (o) => createPgAgentData(db, o),
      fixes: (o) => createPgFixStore(db, o),
      codeHost: () => ({
        target: async () => ({ state: "open", headSha: "sha44", headRepository: "teste/app", repository: "teste/app", branch: "ech-128-filtro", defaultBranch: "main" }),
        readToken: async () => "tok",
        pull: async (_r, n) => pulls.get(n) ?? null,
      }),
      sandbox: { run: async () => ({ sessionId: "sesn_pg", outcome: "done", diff: PATCH, fixJson: { resumo: "Parametrizado.", testes: { comando: "pnpm test", resultado: "passou" } }, costUsd: 0.37 }) },
      outbox: (o) => createPgOutbox(db, o),
      recorder: createDbRunRecorder(db),
      clock: new FixedClock(NOW),
    });

    expect(await fix.pending(org)).toEqual([review]);
    const r = await fix.run(org, review);
    expect(r.status).toBe("draft_queued");
    const fixId = r.status === "draft_queued" ? r.fixId : "";
    expect(await fix.pending(org)).toEqual([]);
    expect(await fix.run(org, review)).toEqual({ status: "skipped", reason: "revisão sem achados ou já tratada" });

    const [row] = await asSystem(db, (tx) => tx.select().from(fixRuns).where(eq(fixRuns.orgId, org)));
    expect(row).toMatchObject({ state: "draft_queued", sessionId: "sesn_pg", baseSha: "sha44", branch: "echo/fix-pr-44", files: ["src/filtros.ts"], testsReported: "passou", costUsd: "0.3700" });
    const [rv] = await asSystem(db, (tx) => tx.select().from(reviews).where(eq(reviews.id, review)));
    expect(rv!.state).toBe("fix_queued");
    expect(await createPgFixStore(db, org).personSpentUsdSince(fernando, new Date("2026-11-01T00:00:00Z"))).toBeCloseTo(0.37);

    // A execução do outbox (Integrações) cria o rascunho e devolve número e versão em `result`.
    await asSystem(db, (tx) => tx.update(outboxActions).set({ state: "done", result: { number: 45, headSha: "d45" } }).where(and(eq(outboxActions.orgId, org), eq(outboxActions.idempotencyKey, `fix_draft:${fixId}`))));
    expect(await fix.sync(org)).toEqual({ ready: 1, applied: 0, failed: 0 });
    pulls.set(45, { state: "open", headSha: "d45" });

    // O plano da manhã de Fernando mostra a correção pronta em primeiro.
    const morning = createMorningPlan({ data: (o) => createPgAgentData(db, o), plans: (o) => createPgPlanStore(db, o), outbox: (o) => createPgOutbox(db, o), recorder: createDbRunRecorder(db), clock: new FixedClock(new Date("2026-11-09T11:45:00Z")), webUrl: "http://localhost:3000" });
    const plan = await morning.build(org, fernando, "2026-11-09");
    expect(plan.status === "created" && plan.plan.items.map((i) => i.text).slice(0, 2)).toEqual(["Correção pronta no seu PR 44, aguardando sua aprovação", "Análise automática do seu PR 44: 1 achado"]);

    // Outra empresa não vê nem decide.
    expect(await createPgFixStore(db, other).inState("ready")).toEqual([]);
    expect(await createPgFixStore(db, other).get(fixId)).toBeNull();

    expect(await fix.decide(org, eduardo, fixId, "approve")).toEqual({ status: "denied" });
    expect(await fix.decide(org, fernando, fixId, "approve")).toEqual({ status: "approved" });
    const merge = await asSystem(db, (tx) => tx.select().from(outboxActions).where(and(eq(outboxActions.orgId, org), eq(outboxActions.type, "github.merge_fix"))));
    expect(merge).toHaveLength(1);
    expect(merge[0]).toMatchObject({ state: "approved", approvedBy: fernando, payload: { number: 45, sha: "d45", base: "ech-128-filtro" } });

    await asSystem(db, (tx) => tx.update(outboxActions).set({ state: "done" }).where(eq(outboxActions.id, merge[0]!.id)));
    expect(await fix.sync(org)).toEqual({ ready: 0, applied: 1, failed: 0 });
    const [done] = await asSystem(db, (tx) => tx.select().from(fixRuns).where(eq(fixRuns.orgId, org)));
    expect(done).toMatchObject({ state: "applied", decidedBy: fernando, draftPrNumber: 45, draftHeadSha: "d45" });
    const [rvDone] = await asSystem(db, (tx) => tx.select().from(reviews).where(eq(reviews.id, review)));
    expect(rvDone!.state).toBe("applied");

    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((x) => x.flow).sort()).toEqual(["fix", "fix_applied", "fix_decision", "fix_decision", "fix_ready", "morning_plan"]);
    expect(runs.find((x) => x.flow === "fix")).toMatchObject({ model: "claude-sonnet-5-5", costUsd: "0.370000", result: "ok" });
  });
});
