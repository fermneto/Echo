// Registro do que o agente fez com o dono fora, contra o Postgres real (DATABASE_URL), sem modelo.
// Pronto quando: o Início mostra só o que o agente da própria pessoa fez desde o fim do expediente.
import { randomUUID } from "node:crypto";
import { asSystem, createDb, createPool, type Database, fixRuns, morningPlans, orgs, people, pullRequests, questions, reviews } from "@echo/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readAwayLog } from "./pg-away-log.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-07T12:00:00Z");
const SINCE = new Date("2026-11-06T21:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe.skipIf(!url)("o que o agente fez com o dono fora, em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const [fernando, eduardo] = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values({ id: org, name: "Enquanto fora" });
      const p = (id: string, name: string) => ({ id, orgId: org, name, role: "member", timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } });
      await tx.insert(people).values([p(fernando, "Fernando"), p(eduardo, "Eduardo")]);
      const q = (ref: string, at: Date, extra: Partial<typeof questions.$inferInsert> = {}) => ({
        orgId: org, askerId: eduardo, ownerId: fernando, kind: "gemeo", channel: "painel", sourceRef: ref, state: "answered", answer: "Agente de Fernando: liberada.", answeredAt: at, ...extra,
      });
      await tx.insert(questions).values([
        q("a", h(5), { text: "posso seguir com a ech-131?", textExpiresAt: h(-40), sources: [{ label: "nota do dia", ref: "daily_note:x" }] }),
        q("b", h(4), { text: "e a ech-128?", textExpiresAt: h(1), needsOwner: true }),
        q("antiga", h(30)),
        q("falhou", h(2), { state: "failed" }),
        q("de-outro", h(2), { ownerId: eduardo, askerId: fernando }),
      ]);
      const [pr] = await tx.insert(pullRequests).values({ orgId: org, repository: "echo/api", number: 41, title: "Tempo limite", authorId: fernando, state: "open", branch: "ech-128" }).returning();
      const [rv] = await tx.insert(reviews).values({ orgId: org, prId: pr!.id, headSha: "abc", state: "fix_ready" }).returning();
      await tx.insert(fixRuns).values({ orgId: org, reviewId: rv!.id, state: "ready", createdAt: h(6) });
      await tx.insert(morningPlans).values({ orgId: org, personId: fernando, date: "2026-11-07", items: [{ id: "x" }, { id: "y" }], createdAt: h(3) });
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await pool?.end();
  });

  it("só perguntas respondidas ao dono na janela, sem texto expirado; correção pronta e plano da manhã", async () => {
    const log = await readAwayLog(db, { orgId: org, personId: fernando, since: SINCE, now: NOW });
    expect(log.questions.map((q) => [q.askerName, q.text, q.needsOwner])).toEqual([
      ["Eduardo", null, true],
      ["Eduardo", "posso seguir com a ech-131?", false],
    ]);
    expect(log.questions[1]!.sources).toEqual([{ label: "nota do dia", ref: "daily_note:x" }]);
    expect(log.fixes).toMatchObject([{ prNumber: 41, prTitle: "Tempo limite", state: "ready" }]);
    expect(log.plan).toMatchObject({ date: "2026-11-07", items: 2 });
  });
});
