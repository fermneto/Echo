// Nota do dia contra o Postgres real (DATABASE_URL), depois de `pnpm db:migrate`. Sem modelo.
import { randomUUID } from "node:crypto";
import { agentRuns, asSystem, createDb, createPool, dailyNotes, type Database, identities, orgs, outboxActions, people, pullRequests, tasks, teams, workEvents } from "@echo/db";
import { FixedClock, HOUR } from "@echo/domain";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgOutbox } from "@echo/actions/pg";
import { createEndOfDay } from "./daily-note.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createPgDailyNoteStore } from "./pg-notes.ts";
import { createDbRunRecorder, dueEndOfDay, serverEndOfDay } from "./server.ts";

const url = process.env.DATABASE_URL;
const END = new Date("2026-11-06T21:05:00Z"); // sexta, 18h05 em Fortaleza

describe.skipIf(!url)("nota do dia em Postgres", () => {
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
      await tx.insert(orgs).values([{ id: org, name: "Nota A" }, { id: other, name: "Nota B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto", loadLimit: 10 });
      await tx.insert(people).values([
        { id: fernando, orgId: org, teamId: team, name: "Fernando Neto", role: "member", timezone: "America/Fortaleza", workHours: hours },
        { id: eduardo, orgId: org, teamId: team, name: "Eduardo", role: "member", timezone: "Africa/Johannesburg", workHours: { ...hours, start: "08:00", end: "17:00" } },
      ]);
      await tx.insert(identities).values({ orgId: org, personId: fernando, platform: "slack", externalId: `U-${org.slice(0, 8)}` });
      await tx.insert(tasks).values({ orgId: org, key: "ECH-128", title: "Tempo limite", assigneeId: fernando, state: "in_progress", linearId: "lin-n1" });
      await tx.insert(pullRequests).values({ orgId: org, repository: "teste/app", number: 44, title: "Tempo limite", authorId: fernando, state: "open", branch: "ech-128-tempo-limite", taskKey: "ECH-128" });
      await tx.insert(workEvents).values({ orgId: org, type: "commit", personId: fernando, repository: "teste/app", branch: "ech-128-tempo-limite", taskKey: "ECH-128", occurredAt: new Date(END.getTime() - HOUR), source: "github", sourceRef: `commit:${randomUUID()}` });
      await tx.insert(dailyNotes).values({ orgId: org, personId: fernando, date: "2026-11-05", released: [{ branch: "ech-131-api-v2", to: eduardo }], reserved: [{ branch: "ech-128-tempo-limite" }], state: "confirmed", confirmedAt: new Date("2026-11-05T21:30:00Z") });
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  it("agenda: Fernando está no fim do expediente; Eduardo, não", async () => {
    const due = (await dueEndOfDay(db, END)).filter((d) => d.orgId === org);
    expect(due).toEqual([{ orgId: org, personId: fernando, date: "2026-11-06" }]);
  });

  it("rascunho, mensagem no outbox uma vez, prazo de 2 h e confirmação, tudo na empresa", async () => {
    const clock = new FixedClock(END);
    // Mesmas dependências de serverEndOfDay, com relógio fixo.
    expect(typeof serverEndOfDay(db, undefined, "http://localhost:3000").draft).toBe("function");
    const eod = createEndOfDay({
      data: (o) => createPgAgentData(db, o),
      notes: (o) => createPgDailyNoteStore(db, o),
      outbox: (o) => createPgOutbox(db, o),
      model: null,
      recorder: createDbRunRecorder(db),
      clock,
      webUrl: "http://localhost:3000",
    });

    expect(await eod.draft(org, fernando, "2026-11-06")).toMatchObject({ status: "created", dmQueued: true });
    expect(await eod.draft(org, fernando, "2026-11-06")).toMatchObject({ status: "skipped" });

    const store = createPgDailyNoteStore(db, org);
    const note = await store.get(fernando, "2026-11-06");
    expect(note).toMatchObject({
      state: "draft",
      stoppedAt: "ECH-128 em andamento; PR 44 aberto na ech-128-tempo-limite.",
      reserved: [{ branch: "ech-128-tempo-limite" }],
      released: [{ branch: "ech-131-api-v2", to: eduardo, confirmedAt: "2026-11-05T21:30:00.000Z" }],
    });

    const outbox = await asSystem(db, (tx) => tx.select().from(outboxActions).where(eq(outboxActions.orgId, org)));
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: "slack.dm", state: "approved", idempotencyKey: `daily_note:${fernando}:2026-11-06` });

    // Outra empresa não lê a nota nem a identidade.
    const outsider = createPgDailyNoteStore(db, other);
    expect(await outsider.get(fernando, "2026-11-06")).toBeNull();
    expect(await outsider.slackUserOf(fernando)).toBeNull();

    clock.set(new Date(END.getTime() + 2 * HOUR));
    expect(await eod.expire(org, fernando, "2026-11-06")).toEqual({ state: "auto_unreviewed", changed: true });
    expect(await eod.confirmFromSlack(org, { type: "block_actions", user: { id: `U-${org.slice(0, 8)}` }, actions: [{ action_id: "confirmar_nota", value: JSON.stringify({ personId: fernando, date: "2026-11-06" }) }] })).toMatchObject({ status: "confirmed" });
    expect((await store.get(fernando, "2026-11-06"))?.state).toBe("confirmed");

    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((r) => `${r.flow}:${r.result}`).sort()).toEqual(["daily_note:fallback", "daily_note:skipped", "daily_note_confirm:ok", "daily_note_timeout:ok"]);
  });

  it("outbox recusa ação que exige aprovação sem aprovador", async () => {
    await expect(createPgOutbox(db, org).enqueue({ type: "linear.assign", target: "linear:ECH-128", payload: {}, idempotencyKey: `x:${randomUUID()}` })).rejects.toThrow(/aprovação/);
    const rows = await asSystem(db, (tx) => tx.select().from(outboxActions).where(and(eq(outboxActions.orgId, org), eq(outboxActions.type, "linear.assign"))));
    expect(rows).toEqual([]);
  });
});
