// Pergunta do painel gravada em `questions` contra o Postgres real (DATABASE_URL), sem modelo.
// Pronto quando: a resposta do painel aparece para os Ganhos e no resumo da ausência do dono, como a do Slack.
import { randomUUID } from "node:crypto";
import { asSystem, createDb, createPool, type Database, orgs, people, questions } from "@echo/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnswerResult } from "./index.ts";
import { createPgDigestStore } from "./pg-away-digest.ts";
import { recordQuestion } from "./pg-questions.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-07T14:00:00Z");

describe.skipIf(!url)("pergunta do painel em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const [fernando, eduardo] = [randomUUID(), randomUUID()];
  const reply: AnswerResult = {
    agentName: "Agente de Fernando",
    text: "Sim, liberada na nota do dia confirmada.\n\nFernando volta segunda-feira.",
    sources: [{ label: "nota do dia de Fernando (confirmada)", ref: "daily_note:x" }],
    needsOwner: false,
    usedModel: false,
    warnings: [],
    kind: "gemeo",
    ownerReturnsAt: new Date("2026-11-09T12:00:00Z"),
    digest: { kind: "nenhum", request: "posso seguir com a ech-131?", reply: "Sim, liberada na nota do dia confirmada." },
  };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values({ id: org, name: "Perguntas do painel" });
      const p = (id: string, name: string) => ({ id, orgId: org, name, role: "member", timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } });
      await tx.insert(people).values([p(fernando, "Fernando"), p(eduardo, "Eduardo")]);
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await pool?.end();
  });

  const req = (extra: { ownerId?: string; text?: string } = {}) => ({ orgId: org, askerId: eduardo, text: "posso seguir com a ech-131?", channel: "painel" as const, ...extra });

  it("gêmeo com o dono fora: respondida, com a volta para os Ganhos e as linhas do resumo", async () => {
    const id = await recordQuestion(db, { req: req({ ownerId: fernando }), reply, at: NOW });
    const [q] = await asSystem(db, (tx) => tx.select().from(questions).where(eq(questions.id, id)));
    expect(q).toMatchObject({ orgId: org, askerId: eduardo, ownerId: fernando, kind: "gemeo", channel: "painel", state: "answered", text: "posso seguir com a ech-131?", answer: reply.text, needsOwner: false, digestKind: "nenhum", digestRequest: "posso seguir com a ech-131?", digestReply: "Sim, liberada na nota do dia confirmada.", digestedAt: null });
    expect(q!.sourceRef).toMatch(/^painel:/);
    expect(q!.sources).toEqual(reply.sources);
    expect(q!.ownerReturnsAt).toEqual(reply.ownerReturnsAt);
    expect(q!.answeredAt).toEqual(NOW);
    expect(q!.textExpiresAt).toEqual(new Date(NOW.getTime() + 48 * 3_600_000));
    // O resumo da ausência de Fernando vê a pergunta.
    expect((await createPgDigestStore(db, org).pending(fernando, new Date(0))).map((i) => i.id)).toEqual([id]);
  });

  it("acima do dobro do limite: falha; Echo da equipe: sem dono e sem resumo", async () => {
    const over = await recordQuestion(db, { req: req({ ownerId: fernando, text: "e o ECH-140?" }), reply: { ...reply, ownerReturnsAt: undefined, overLimit: true }, at: NOW });
    const { digest: _, ownerReturnsAt: __, ...noOwner } = reply;
    const livre = await recordQuestion(db, { req: req({ text: "quem está livre?" }), reply: { ...noOwner, agentName: "Echo", kind: "livre" }, at: NOW });
    const rows = await asSystem(db, (tx) => tx.select().from(questions).where(eq(questions.orgId, org)));
    expect(rows.find((r) => r.id === over)).toMatchObject({ state: "failed", ownerReturnsAt: null });
    expect(rows.find((r) => r.id === livre)).toMatchObject({ state: "answered", ownerId: null, kind: "livre", digestRequest: null, ownerReturnsAt: null });
  });
});
