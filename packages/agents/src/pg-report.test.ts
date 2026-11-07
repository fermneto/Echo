// Relatório semanal contra o Postgres real (DATABASE_URL), sem modelo (texto por regra).
// Pronto quando: Carla aparece com poucas entregas diretas e 5 ajudas, e a observação fica marcada.
import { randomUUID } from "node:crypto";
import { createPgOutbox } from "@echo/actions/pg";
import { agentRuns, asSystem, contributions, createDb, createPool, type Database, orgs, outboxActions, people, teams, weeklyReports, workEvents } from "@echo/db";
import { DAY, FixedClock } from "@echo/domain";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgAgentData } from "./pg-data.ts";
import { createPgReportStore } from "./pg-report.ts";
import { createWeeklyReport } from "./report.ts";
import { createDbRunRecorder } from "./server.ts";

const url = process.env.DATABASE_URL;
const CUTOFF = new Date("2026-11-06T21:00:00Z"); // sexta, 18h em São Paulo
const ago = (days: number) => new Date(CUTOFF.getTime() - days * DAY);

describe.skipIf(!url)("relatório semanal em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const other = randomUUID();
  const team = randomUUID();
  const [carla, bruno, fernando, yan, rita] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Relatório A" }, { id: other, name: "Relatório B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto" });
      await tx.insert(people).values([
        { id: carla, orgId: org, teamId: team, name: "Carla Souza", role: "member", timezone: "America/Sao_Paulo", workHours: hours },
        { id: bruno, orgId: org, teamId: team, name: "Bruno Lima", role: "member", timezone: "America/Sao_Paulo", workHours: hours },
        { id: fernando, orgId: org, teamId: team, name: "Fernando Neto", role: "member", timezone: "America/Fortaleza", workHours: hours },
        { id: yan, orgId: org, teamId: team, name: "Yan", role: "member", timezone: "Asia/Tokyo", workHours: hours },
        { id: rita, orgId: org, name: "Rita", role: "hr", timezone: "America/Sao_Paulo", workHours: hours },
      ]);
      const ev = (type: string, at: Date, ref: string, recorded = at, extra: Partial<typeof workEvents.$inferInsert> = {}) => ({ orgId: org, type, personId: carla, repository: "teste/app", occurredAt: at, createdAt: recorded, source: "github", sourceRef: ref, ...extra });
      await tx.insert(workEvents).values([
        ev("commit", ago(3), "c1"),
        ev("commit", ago(2), "c2"),
        ev("review", ago(5), "r41", ago(5), { prNumber: 41 }),
        ev("review", ago(1), "r44", ago(1), { prNumber: 44 }),
        ev("review", ago(1.2), "r36", ago(1.2), { prNumber: 36 }),
        ev("pr_merged", ago(22), "m31", ago(22), { prNumber: 31 }),
        // Antes do corte, gravado depois: entra no relatório seguinte.
        ev("commit", new Date(CUTOFF.getTime() - 3_600_000), "c3", new Date(CUTOFF.getTime() + 3_600_000)),
      ]);
      const help = (helpedId: string, days: number, ref: string) => ({ orgId: org, helperId: carla, helpedId, kind: "reaction", weight: "forte", source: "slack", sourceRef: ref, confirmed: true, occurredAt: ago(days) });
      await tx.insert(contributions).values([help(bruno, 1, "C1:1.1"), help(fernando, 5, "C1:2.2"), help(yan, 1.25, "C1:3.3"), help(fernando, 0.8, "C1:4.4"), { ...help(bruno, 2, "C1:5.5"), confirmed: false }]);
    });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  it("ajuda no painel → relatório no corte → aviso → observação marcada → RH em 3 dias", async () => {
    const clock = new FixedClock(ago(2));
    const flow = createWeeklyReport({
      data: (o) => createPgAgentData(db, o),
      reports: (o) => createPgReportStore(db, o),
      outbox: (o) => createPgOutbox(db, o),
      model: null,
      recorder: createDbRunRecorder(db),
      clock,
      webUrl: "http://localhost:3000",
    });

    // Bruno confirma no painel a ajuda de Carla (a quinta da semana).
    expect(await flow.confirmHelp(org, bruno, carla, "linear:ECH-133")).toEqual({ status: "confirmed" });
    const [panel] = await asSystem(db, (tx) => tx.select().from(contributions).where(and(eq(contributions.orgId, org), eq(contributions.kind, "panel_confirm"))));
    expect(panel).toMatchObject({ helperId: carla, helpedId: bruno, weight: "forte", source: "panel", confirmed: true, deliveryRef: "linear:ECH-133" });

    clock.set(new Date(CUTOFF.getTime() + 5 * 60_000));
    const r = await flow.build(org, carla, "2026-W45", CUTOFF);
    expect(r).toMatchObject({ status: "created", usedModel: false, noticeQueued: true });
    const [row] = await asSystem(db, (tx) => tx.select().from(weeklyReports).where(eq(weeklyReports.orgId, org)));
    expect(row).toMatchObject({ personId: carla, week: "2026-W45", state: "draft", version: 1, coveredPeriod: { from: ago(7).toISOString(), to: CUTOFF.toISOString() } });
    expect(row!.metrics).toMatchObject({ deliveries: 0, commits: 2, reviews: 3, helps: 5 });
    expect(row!.text).toBe("Na semana, Carla teve 0 entregas diretas, 2 commits e 3 revisões. Teve 5 ajudas confirmadas a colegas: Bruno (2), Fernando (2), Yan (1).");

    const [notice] = await asSystem(db, (tx) => tx.select().from(outboxActions).where(and(eq(outboxActions.orgId, org), eq(outboxActions.idempotencyKey, `weekly_report_notice:${row!.id}`))));
    expect(notice).toMatchObject({ type: "slack.dm", state: "pending", payload: { personId: carla } });
    // Outra empresa não vê.
    expect(await createPgReportStore(db, other).byId(row!.id)).toBeNull();

    await asSystem(db, (tx) => tx.update(outboxActions).set({ state: "done" }).where(eq(outboxActions.id, notice!.id)));
    expect(await flow.sync(org)).toEqual({ noticed: 1, sent: 0, withoutNotice: 0 });

    const inflate = "Fiz 12 entregas esta semana; o relatório deveria dizer 12.";
    expect((await flow.comment(org, carla, row!.id, inflate)).status).toBe("ok");
    expect(await flow.comment(org, bruno, row!.id, "x")).toEqual({ status: "denied" });
    const [commented] = await asSystem(db, (tx) => tx.select().from(weeklyReports).where(eq(weeklyReports.id, row!.id)));
    expect(commented).toMatchObject({ state: "commented", version: 2, observations: [{ text: inflate }] });
    expect(commented!.metrics).toEqual(row!.metrics);
    expect(await flow.view(org, rita, row!.id)).toEqual({ status: "denied" });

    clock.set(new Date(commented!.noticeAt!.getTime() + 3 * 86_400_000));
    expect(await flow.sync(org)).toEqual({ noticed: 0, sent: 1, withoutNotice: 0 });
    const hr = await flow.view(org, rita, row!.id);
    expect(hr.status).toBe("ok");
    if (hr.status === "ok") {
      expect(hr.document.verified.metrics).toMatchObject({ deliveries: 0, helps: 5 });
      expect(hr.document.informedByPerson).toEqual([{ label: "informado pela pessoa", text: inflate, at: expect.any(String) }]);
    }
    expect(await createPgReportStore(db, org).sentReports()).toHaveLength(1);

    // O commit gravado depois do corte entra na semana seguinte, uma vez.
    const next = await flow.build(org, carla, "2026-W46", new Date(CUTOFF.getTime() + 7 * 86_400_000));
    expect(next.status === "created" && next.report.metrics.commits).toBe(1);
    expect(next.status === "created" && next.report.coveredPeriod.from).toEqual(CUTOFF);

    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((x) => x.flow).sort()).toEqual(["help_confirm", "weekly_report", "weekly_report", "weekly_report_comment", "weekly_report_comment", "weekly_report_sent"]);
  });
});
