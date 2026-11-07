// Relatórios semanais em Postgres. Toda consulta em withOrg com filtro explícito de org_id; cada mudança de
// estado só sai do estado esperado (o mesmo relatório nunca segue duas vezes ao RH).
import { contributions, type Database, outboxActions, weeklyReports, withOrg } from "@echo/db";
import type { ReportObservation, ReportState, WeeklyMetrics } from "@echo/domain";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { ReportStore, StoredReport } from "./report.ts";

type Row = typeof weeklyReports.$inferSelect;

const toReport = (r: Row): StoredReport => ({
  id: r.id,
  personId: r.personId,
  week: r.week,
  metrics: r.metrics as WeeklyMetrics,
  text: r.text ?? "",
  observations: r.observations,
  version: r.version,
  state: r.state as ReportState,
  coveredPeriod: { from: new Date(r.coveredPeriod.from), to: new Date(r.coveredPeriod.to) },
  ...(r.noticeAt ? { noticeAt: r.noticeAt } : {}),
  ...(r.sentAt ? { sentAt: r.sentAt } : {}),
});

export function createPgReportStore(db: Database, orgId: string): ReportStore & { sentReports(): Promise<StoredReport[]> } {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);
  const one = async (where: ReturnType<typeof and>) => {
    const [row] = await run((tx) => tx.select().from(weeklyReports).where(and(eq(weeklyReports.orgId, orgId), where)));
    return row ? toReport(row) : null;
  };

  return {
    get: (personId, week) => one(and(eq(weeklyReports.personId, personId), eq(weeklyReports.week, week))),
    byId: (id) => one(eq(weeklyReports.id, id)),
    async previous(personId, week) {
      const [row] = await run((tx) =>
        tx
          .select()
          .from(weeklyReports)
          .where(and(eq(weeklyReports.orgId, orgId), eq(weeklyReports.personId, personId), lt(weeklyReports.week, week)))
          .orderBy(desc(weeklyReports.week))
          .limit(1),
      );
      return row ? toReport(row) : null;
    },
    async create(r) {
      const [row] = await run((tx) =>
        tx
          .insert(weeklyReports)
          .values({ orgId, personId: r.personId, week: r.week, metrics: r.metrics, text: r.text, state: "draft", coveredPeriod: { from: r.coveredPeriod.from.toISOString(), to: r.coveredPeriod.to.toISOString() } })
          .onConflictDoNothing()
          .returning(),
      );
      return row ? toReport(row) : null;
    },
    async inStates(states) {
      const rows = await run((tx) => tx.select().from(weeklyReports).where(and(eq(weeklyReports.orgId, orgId), inArray(weeklyReports.state, states))).orderBy(weeklyReports.week, weeklyReports.id));
      return rows.map(toReport);
    },
    async setState(id, from, to, patch = {}) {
      const rows = await run((tx) =>
        tx
          .update(weeklyReports)
          .set({ state: to, ...(patch.noticeAt ? { noticeAt: patch.noticeAt } : {}), ...(patch.sentAt ? { sentAt: patch.sentAt } : {}) })
          .where(and(eq(weeklyReports.orgId, orgId), eq(weeklyReports.id, id), inArray(weeklyReports.state, from)))
          .returning({ id: weeklyReports.id }),
      );
      return rows.length > 0;
    },
    async addObservation(id, from, to, obs: ReportObservation, noticeAt) {
      const rows = await run((tx) =>
        tx
          .update(weeklyReports)
          .set({
            state: to,
            observations: sql`${weeklyReports.observations} || ${JSON.stringify([obs])}::jsonb`,
            version: sql`${weeklyReports.version} + 1`,
            ...(noticeAt ? { noticeAt } : {}),
          })
          .where(and(eq(weeklyReports.orgId, orgId), eq(weeklyReports.id, id), inArray(weeklyReports.state, from)))
          .returning({ id: weeklyReports.id }),
      );
      return rows.length > 0;
    },
    async outboxState(idempotencyKey) {
      const [row] = await run((tx) => tx.select({ state: outboxActions.state }).from(outboxActions).where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.idempotencyKey, idempotencyKey))));
      return row?.state ?? null;
    },
    async confirmHelp(input) {
      const rows = await run((tx) =>
        tx
          .insert(contributions)
          .values({
            orgId,
            helperId: input.helperId,
            helpedId: input.helpedId,
            kind: "panel_confirm",
            weight: "forte",
            source: "panel",
            sourceRef: input.sourceRef,
            confirmed: true,
            occurredAt: input.occurredAt,
            ...(input.deliveryRef ? { deliveryRef: input.deliveryRef } : {}),
          })
          .onConflictDoNothing()
          .returning({ id: contributions.id }),
      );
      return rows.length > 0;
    },
    async sentReports() {
      const rows = await run((tx) => tx.select().from(weeklyReports).where(and(eq(weeklyReports.orgId, orgId), inArray(weeklyReports.state, ["sent", "sent_without_notice"]))).orderBy(desc(weeklyReports.week)));
      return rows.map(toReport);
    },
  };
}
