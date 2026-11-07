// Noite e manhã contra o Postgres real (DATABASE_URL), com a API de lotes simulada.
// Pronto quando: um PR recebe análise, e o plano da manhã do autor mostra o item.
import { randomUUID } from "node:crypto";
import { createPgOutbox } from "@echo/actions/pg";
import { createPgBrainStore } from "@echo/brain/pg";
import { agentRuns, asSystem, createDb, createPool, type Database, identities, morningPlans, orgs, outboxActions, people, pullRequests, questions, reviews, teams } from "@echo/db";
import { FixedClock } from "@echo/domain";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMorningPlan } from "./morning-plan.ts";
import { type BatchApi, type BatchItemResult, createNightReview } from "./night-review.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createPgPlanStore, createPgReviewStore } from "./pg-night.ts";
import { createDbRunRecorder, dueMorning } from "./server.ts";

const url = process.env.DATABASE_URL;
const NIGHT = new Date("2026-11-09T05:00:00Z");
const MORNING = new Date("2026-11-09T11:45:00Z"); // segunda, 08h45 em Fortaleza

describe.skipIf(!url)("noite e manhã em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const other = randomUUID();
  const team = randomUUID();
  const fernando = randomUUID();
  const eduardo = randomUUID();
  const pr44 = randomUUID();
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Noite A" }, { id: other, name: "Noite B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto", loadLimit: 10 });
      await tx.insert(people).values([
        { id: fernando, orgId: org, teamId: team, name: "Fernando Neto", role: "member", timezone: "America/Fortaleza", workHours: hours },
        { id: eduardo, orgId: org, teamId: team, name: "Eduardo", role: "member", timezone: "Africa/Johannesburg", workHours: hours },
      ]);
      await tx.insert(identities).values({ orgId: org, personId: fernando, platform: "slack", externalId: `U-${org.slice(0, 8)}` });
      await tx.insert(pullRequests).values({ id: pr44, orgId: org, repository: "teste/app", number: 44, title: "Tempo limite", authorId: fernando, state: "open", branch: "ech-128-tempo-limite", headSha: "sha44" });
      await tx.insert(questions).values({ orgId: org, askerId: eduardo, ownerId: fernando, kind: "gemeo", channel: "painel", sourceRef: `q:${randomUUID()}`, text: "e a ech-128-tempo-limite, posso mexer?", needsOwner: true, state: "answered", createdAt: new Date(NIGHT.getTime() - 2 * 3600_000) });
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  it("o PR recebe análise pelo outbox, e o plano da manhã de Fernando mostra o achado", async () => {
    const created: string[][] = [];
    let ended = false;
    const out: BatchItemResult[] = [];
    const batches: BatchApi = {
      create: async (requests) => (created.push(requests.map((r) => r.custom_id)), { id: "batch_pg" }),
      status: async () => (ended ? "ended" : "in_progress"),
      results: async function* () { for (const r of out) yield r; },
    };
    const night = createNightReview({
      data: (o) => createPgAgentData(db, o),
      brain: (o) => createPgBrainStore(db, o),
      reviews: (o) => createPgReviewStore(db, o),
      diffs: () => ({ getDiff: async () => ({ headSha: "sha44", files: [{ path: "src/pagamentos/cliente.ts", additions: 30, deletions: 2 }], totalChars: 900, patch: "+const TIMEOUT = 30000;" }) }),
      outbox: (o) => createPgOutbox(db, o),
      batches,
      recorder: createDbRunRecorder(db),
      clock: new FixedClock(NIGHT),
    });

    expect(await night.prepareAndSubmit(org)).toMatchObject({ queued: 1, batchId: "batch_pg" });
    const [review] = await asSystem(db, (tx) => tx.select().from(reviews).where(eq(reviews.orgId, org)));
    expect(review).toMatchObject({ state: "batched", batchId: "batch_pg", model: "claude-opus-5-5", files: ["src/pagamentos/cliente.ts"] });

    ended = true;
    out.push({
      custom_id: review!.id,
      result: {
        type: "succeeded",
        message: { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 2000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ achados: [{ arquivo: "src/pagamentos/cliente.ts", linha: 1, gravidade: "alta", explicacao: "Tempo limite fixo de 30 s, fora da configuração.", sugestao: "Usar a constante de configuração.", confianca: 0.9 }] }), citations: null }] } as never,
      },
    });
    expect(await night.collect(org)).toMatchObject({ reviewed: 1 });
    expect(await night.collect(org)).toMatchObject({ reviewed: 0 });

    const comments = await asSystem(db, (tx) => tx.select().from(outboxActions).where(eq(outboxActions.orgId, org)));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ type: "github.comment", target: "github:teste/app#44", state: "pending" });
    expect((comments[0]!.payload as { body: string }).body).toMatch(/^\*\*Análise automática do Echo\.\*\* Isto não é uma aprovação/);

    // Manhã: a agenda acha Fernando, e o plano traz a pergunta de Eduardo e o achado da noite.
    expect((await dueMorning(db, MORNING)).filter((d) => d.orgId === org)).toEqual([{ orgId: org, personId: fernando, date: "2026-11-09" }]);
    const morning = createMorningPlan({
      data: (o) => createPgAgentData(db, o),
      plans: (o) => createPgPlanStore(db, o),
      outbox: (o) => createPgOutbox(db, o),
      recorder: createDbRunRecorder(db),
      clock: new FixedClock(MORNING),
      webUrl: "http://localhost:3000",
    });
    expect(await morning.build(org, fernando, "2026-11-09")).toMatchObject({ status: "created", dmQueued: true });
    const [plan] = await asSystem(db, (tx) => tx.select().from(morningPlans).where(eq(morningPlans.orgId, org)));
    expect((plan!.items as { text: string }[]).map((i) => i.text)).toEqual([
      "Eduardo deixou uma pergunta sobre ech-128-tempo-limite e está esperando",
      "Análise automática do seu PR 44: 1 achado",
    ]);

    // Outra empresa não vê revisões nem planos.
    expect(await createPgReviewStore(db, other).batched()).toEqual([]);
    expect(await createPgPlanStore(db, other).get(fernando, "2026-11-09")).toBeNull();

    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((r) => r.flow).sort()).toEqual(["morning_plan", "night_review", "night_review_batch"]);
    expect(runs.find((r) => r.flow === "night_review")).toMatchObject({ model: "claude-opus-5-5", costUsd: "0.007000" });
  });
});
