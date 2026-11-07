// Redistribuição em Postgres. Toda consulta em withOrg com filtro explícito de org_id; plano e item só mudam a
// partir do estado esperado (aprovar duas vezes ou recusar duas vezes não faz nada).
// Sem migração nova: quem se ausenta fica em `options.absentId` do plano.
import { absences, type Database, identities, people, planItems, redistributionPlans, tasks, teams, withOrg } from "@echo/db";
import type { AbsenceKind } from "@echo/domain";
import { and, asc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { ItemState, PlanState, PlanTrigger, RedistributionStore, StoredAbsence, StoredPlanItem, StoredRedistribution } from "./redistribution.ts";

const DAY = 86_400_000;
type PlanRow = typeof redistributionPlans.$inferSelect;
type ItemRow = typeof planItems.$inferSelect;

const toAbsence = (a: typeof absences.$inferSelect): StoredAbsence => ({ id: a.id, personId: a.personId, startsAt: a.startsAt, endsAt: a.endsAt, kind: a.kind as AbsenceKind, cancelled: a.cancelledAt !== null });
const toItem = (i: ItemRow): StoredPlanItem => ({
  id: i.id,
  ...(i.taskId ? { taskId: i.taskId } : {}),
  ...(i.prId ? { prId: i.prId } : {}),
  fromId: i.fromId ?? "",
  ...(i.toId ? { toId: i.toId } : {}),
  reason: i.reason ?? "",
  state: i.state as ItemState,
});

export function createPgRedistributionStore(db: Database, orgId: string): RedistributionStore {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);

  async function plans(where: ReturnType<typeof and>): Promise<StoredRedistribution[]> {
    return run(async (tx) => {
      const rows = await tx.select().from(redistributionPlans).where(and(eq(redistributionPlans.orgId, orgId), where)).orderBy(asc(redistributionPlans.createdAt), asc(redistributionPlans.id));
      if (rows.length === 0) return [];
      const items = await tx
        .select()
        .from(planItems)
        .where(and(eq(planItems.orgId, orgId), inArray(planItems.planId, rows.map((r) => r.id))))
        .orderBy(asc(planItems.taskId), asc(planItems.prId), asc(planItems.id));
      return rows.map((p: PlanRow) => ({
        id: p.id,
        trigger: p.trigger as PlanTrigger,
        ...(p.absenceId ? { absenceId: p.absenceId } : {}),
        absentId: (p.options as { absentId?: string } | null)?.absentId ?? "",
        state: p.state as PlanState,
        ...(p.approvedBy ? { approvedBy: p.approvedBy } : {}),
        // Tarefas antes das revisões, como no plano.
        items: items.filter((i) => i.planId === p.id).sort((a, b) => Number(a.taskId === null) - Number(b.taskId === null)).map(toItem),
      }));
    });
  }

  return {
    async absence(id) {
      const [row] = await run((tx) => tx.select().from(absences).where(and(eq(absences.orgId, orgId), eq(absences.id, id))));
      return row ? toAbsence(row) : null;
    },
    async createAbsence(input) {
      const [row] = await run((tx) => tx.insert(absences).values({ orgId, personId: input.personId, startsAt: input.startsAt, endsAt: input.endsAt, kind: input.kind, source: "panel" }).returning({ id: absences.id }));
      return row!.id;
    },
    async recentAbsences(now, sinceDays) {
      const rows = await run((tx) =>
        tx
          .select()
          .from(absences)
          .where(and(eq(absences.orgId, orgId), isNull(absences.cancelledAt), gte(absences.endsAt, new Date(now.getTime() - sinceDays * DAY))))
          .orderBy(asc(absences.startsAt), asc(absences.id)),
      );
      return rows.filter((a) => a.startsAt.getTime() <= now.getTime()).map(toAbsence);
    },
    plansForAbsence: (absenceId) => plans(eq(redistributionPlans.absenceId, absenceId)),
    async createPlan(input) {
      const id = await run(async (tx) => {
        const [plan] = await tx
          .insert(redistributionPlans)
          .values({ orgId, trigger: input.trigger, ...(input.absenceId ? { absenceId: input.absenceId } : {}), options: { absentId: input.absentId }, state: input.items.length ? "awaiting_leader" : "done" })
          .returning({ id: redistributionPlans.id });
        if (input.items.length) {
          await tx.insert(planItems).values(
            input.items.map((i) => ({ orgId, planId: plan!.id, taskId: i.taskId ?? null, prId: i.prId ?? null, fromId: i.fromId, toId: i.toId ?? null, reason: i.reason, state: i.state })),
          );
        }
        return plan!.id;
      });
      return (await plans(eq(redistributionPlans.id, id)))[0]!;
    },
    async get(planId) {
      return (await plans(eq(redistributionPlans.id, planId)))[0] ?? null;
    },
    async planOfItem(itemId) {
      const [row] = await run((tx) => tx.select({ planId: planItems.planId }).from(planItems).where(and(eq(planItems.orgId, orgId), eq(planItems.id, itemId))));
      return row ? ((await plans(eq(redistributionPlans.id, row.planId)))[0] ?? null) : null;
    },
    inState: (state) => plans(eq(redistributionPlans.state, state)),
    async setPlanState(planId, from, to, patch = {}) {
      const rows = await run((tx) =>
        tx
          .update(redistributionPlans)
          .set({ state: to, ...(patch.approvedBy ? { approvedBy: patch.approvedBy } : {}), ...(patch.approvedAt ? { approvedAt: patch.approvedAt } : {}), ...(patch.choice !== undefined ? { choice: patch.choice } : {}) })
          .where(and(eq(redistributionPlans.orgId, orgId), eq(redistributionPlans.id, planId), inArray(redistributionPlans.state, from)))
          .returning({ id: redistributionPlans.id }),
      );
      return rows.length > 0;
    },
    async updateItem(itemId, from, patch) {
      const rows = await run((tx) =>
        tx
          .update(planItems)
          .set({
            ...(patch.toId !== undefined ? { toId: patch.toId } : {}),
            ...(patch.state ? { state: patch.state } : {}),
            ...(patch.refusal !== undefined ? { refusal: patch.refusal } : {}),
            ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
          })
          .where(and(eq(planItems.orgId, orgId), eq(planItems.id, itemId), inArray(planItems.state, from)))
          .returning({ id: planItems.id }),
      );
      return rows.length > 0;
    },
    async linearAccounts() {
      const rows = await run((tx) =>
        tx
          .select({ personId: identities.personId })
          .from(identities)
          .innerJoin(people, and(eq(people.id, identities.personId), eq(people.orgId, orgId)))
          .where(and(eq(identities.orgId, orgId), eq(identities.platform, "linear"))),
      );
      return new Set(rows.map((r) => r.personId));
    },
    async teamLeader(teamId) {
      const [row] = await run((tx) => tx.select({ leaderId: teams.leaderId }).from(teams).where(and(eq(teams.orgId, orgId), eq(teams.id, teamId))));
      return row?.leaderId ?? null;
    },
    async assignLocalTask(taskId, toId) {
      // Só a tarefa que não existe no Linear: a do Linear muda pelo executor e volta pela sincronização.
      await run((tx) => tx.update(tasks).set({ assigneeId: toId }).where(and(eq(tasks.orgId, orgId), eq(tasks.id, taskId), isNull(tasks.linearId))));
    },
  };
}
