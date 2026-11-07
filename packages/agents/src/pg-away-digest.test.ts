// Resumo da ausência contra o Postgres real (DATABASE_URL), sem modelo.
// Pronto quando: o resumo chega à pessoa (outbox slack.dm), e as linhas somem na entrega ou em 30 dias.
import { randomUUID } from "node:crypto";
import { createPgOutbox } from "@echo/actions/pg";
import { agentRuns, asSystem, createDb, createPool, type Database, orgs, outboxActions, people, questions } from "@echo/db";
import { DAY, FixedClock, HOUR } from "@echo/domain";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAwayDigest } from "./away-digest.ts";
import { createPgDigestStore } from "./pg-away-digest.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createDbRunRecorder, dueAwayDigests } from "./server.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-09T12:05:00Z"); // segunda, 09h05 em Fortaleza
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe.skipIf(!url)("resumo da ausência em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const other = randomUUID();
  const [fernando, eduardo, marina, ex] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  const q = (ref: string, extra: Partial<typeof questions.$inferInsert>) => ({ orgId: org, askerId: eduardo, ownerId: fernando, kind: "gemeo", channel: "slack:C1", sourceRef: `${ref}-${org}`, ...extra });

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Resumo A" }, { id: other, name: "Resumo B" }]);
      const p = (id: string, name: string, extra: Partial<typeof people.$inferInsert> = {}) => ({ id, orgId: org, name, role: "member", timezone: "America/Fortaleza", workHours: hours, ...extra });
      await tx.insert(people).values([p(fernando, "Fernando Neto"), p(eduardo, "Eduardo"), p(marina, "Marina", { role: "leader" }), p(ex, "Ex", { active: false, offboardedAt: ago(DAY) })]);
      await tx.insert(questions).values([
        q("prop", { askerId: marina, state: "answered", needsOwner: true, digestKind: "reuniao", digestRequest: "Podemos marcar uma reunião de alinhamento na quinta?", digestReply: "Fernando decide na volta.", createdAt: ago(10 * HOUR) }),
        q("resp", { state: "answered", digestKind: "nenhum", digestRequest: "posso seguir com a branch ech-131-api-v2?", digestReply: "Sim, liberada na nota do dia confirmada.", createdAt: ago(9 * HOUR) }),
        q("falha", { state: "failed", digestKind: "falha_avisada", digestRequest: "e o ECH-140?", createdAt: ago(8 * HOUR) }),
        // Antiga: fica fora e a limpeza apaga as linhas.
        q("velha", { state: "answered", digestKind: "nenhum", digestRequest: "pergunta antiga", digestReply: "resposta antiga", createdAt: ago(31 * DAY) }),
        // Dono desligado: a limpeza apaga.
        q("ex", { ownerId: ex, state: "answered", digestKind: "nenhum", digestRequest: "para quem saiu", digestReply: "x", createdAt: ago(HOUR) }),
      ]);
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  const flow = (now: Date) =>
    createAwayDigest({ data: (o) => createPgAgentData(db, o), store: (o) => createPgDigestStore(db, o), outbox: (o) => createPgOutbox(db, o), recorder: createDbRunRecorder(db), clock: new FixedClock(now), webUrl: "http://localhost:3000" });

  it("agenda no início do expediente → resumo agrupado no outbox → linhas apagadas → 3 horas até o próximo", async () => {
    const due = (await dueAwayDigests(db, NOW)).filter((d) => d.orgId === org);
    expect(due).toEqual([{ orgId: org, personId: fernando, date: "2026-11-09", slot: "inicio" }]);

    const r = await flow(NOW).send(org, fernando, { date: "2026-11-09", slot: "inicio" });
    expect(r).toEqual({ status: "sent", items: 3, sections: { propostas: 1, decisoes: 0, sem_resposta: 1, respondidas: 1 } });

    const [dm] = await asSystem(db, (tx) => tx.select().from(outboxActions).where(and(eq(outboxActions.orgId, org), eq(outboxActions.idempotencyKey, `away_digest:${fernando}:2026-11-09:inicio`))));
    expect(dm).toMatchObject({ type: "slack.dm", target: `person:${fernando}`, payload: { personId: fernando } });
    const text = (dm!.payload as { text: string }).text;
    expect(text).toContain("• Marina: Podemos marcar uma reunião de alinhamento na quinta?");
    expect(text).toContain("*Sem resposta (1):*\n• Eduardo: e o ECH-140?");
    expect(text).toContain("• Eduardo: posso seguir com a branch ech-131-api-v2? → Sim, liberada na nota do dia confirmada.");
    expect(text).not.toContain("pergunta antiga");

    const rows = await asSystem(db, (tx) => tx.select().from(questions).where(and(eq(questions.orgId, org), eq(questions.ownerId, fernando))));
    const delivered = rows.filter((x) => x.digestedAt);
    expect(delivered).toHaveLength(3);
    for (const x of delivered) expect([x.digestRequest, x.digestReply]).toEqual([null, null]);
    // A pergunta continua para os Ganhos.
    expect(delivered.every((x) => x.state !== null)).toBe(true);

    expect(await createPgDigestStore(db, org).lastSentAt(fernando)).toEqual(NOW);
    // Fim do expediente: nada novo, nada na agenda.
    expect((await dueAwayDigests(db, new Date("2026-11-09T21:30:00Z"))).filter((d) => d.orgId === org)).toEqual([]);

    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((x) => [x.flow, x.result, x.model])).toEqual([["away_digest", "ok", null]]);
  });

  it("limpeza: linhas com mais de 30 dias e de quem foi desligado; outra empresa não vê", async () => {
    expect(await createPgDigestStore(db, other).pending(fernando, ago(60 * DAY))).toEqual([]);
    expect(await flow(NOW).purge(org)).toBe(2);
    const left = await asSystem(db, (tx) => tx.select().from(questions).where(eq(questions.orgId, org)));
    expect(left.filter((x) => x.digestRequest !== null || x.digestReply !== null)).toEqual([]);
    expect(left).toHaveLength(5);
  });
});
