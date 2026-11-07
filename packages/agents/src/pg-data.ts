// AgentData em Postgres. Toda consulta roda em withOrg e filtra org_id de forma explícita
// (o superusuário do banco local passa pelo RLS). Só leitura.
import {
  absences,
  agentRuns,
  contributions,
  dailyNotes,
  type Database,
  orgs,
  people,
  pullRequests,
  tasks,
  teams,
  withOrg,
  workEvents,
} from "@echo/db";
import type { Absence, AbsenceKind, Contribution, ContributionKind, DailyNote, DailyNoteState, Person, PersonRole, PrState, PullRequest, Task, TaskState, WorkEvent, WorkEventType } from "@echo/domain";
import { and, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { AgentData } from "./data.ts";

const OPEN_TASK_STATES = ["backlog", "todo", "in_progress", "in_review"];
const OPEN_PR_STATES = ["open", "draft"];
const opt = <T>(v: T | null | undefined): T | undefined => v ?? undefined;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toTask(r: typeof tasks.$inferSelect): Task {
  return {
    id: r.id,
    key: r.key,
    title: r.title,
    assigneeId: opt(r.assigneeId),
    state: r.state as TaskState,
    dueDate: r.dueDate && ISO_DATE.test(r.dueDate) ? r.dueDate : undefined,
    size: opt(r.size),
    area: opt(r.area),
    labels: r.labels,
    hasLinearId: r.linearId !== null,
  };
}

function toPr(r: typeof pullRequests.$inferSelect): PullRequest {
  return {
    id: r.id,
    repository: r.repository,
    number: r.number,
    title: r.title,
    authorId: opt(r.authorId),
    state: r.state as PrState,
    branch: r.branch,
    files: r.files,
    taskKey: opt(r.taskKey),
    reviewerIds: r.reviewerIds,
    openedAt: opt(r.openedAt),
    mergedAt: opt(r.mergedAt),
  };
}

const mark = (m: { branch: string; to?: string; reason?: string; until?: string }) => ({
  branch: m.branch,
  ...(m.to ? { to: m.to } : {}),
  ...(m.reason ? { reason: m.reason } : {}),
  ...(m.until ? { until: m.until } : {}),
});

export function createPgAgentData(db: Database, orgId: string): AgentData {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);

  return {
    async orgSettings() {
      return run(async (tx) => {
        const [org] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
        if (!org) throw new Error("empresa não encontrada");
        const teamRows = await tx.select({ id: teams.id, loadLimit: teams.loadLimit }).from(teams).where(eq(teams.orgId, orgId));
        return {
          monthlyLimitUsd: Number(org.monthlyLimitUsd),
          hardLimitUsd: Number(org.hardLimitUsd),
          repositoriesOpenToTeam: org.repositoriesOpenToTeam,
          teamLoadLimits: Object.fromEntries(teamRows.map((t) => [t.id, t.loadLimit])),
        };
      });
    },

    async spentUsdSince(since) {
      const [row] = await run((tx) =>
        tx
          .select({ total: sql<string | null>`sum(${agentRuns.costUsd})` })
          .from(agentRuns)
          .where(and(eq(agentRuns.orgId, orgId), gte(agentRuns.createdAt, since))),
      );
      return Number(row?.total ?? 0);
    },

    async people() {
      const rows = await run((tx) => tx.select().from(people).where(and(eq(people.orgId, orgId), isNull(people.offboardedAt))));
      return rows.map(
        (r): Person => ({
          id: r.id,
          orgId: r.orgId,
          name: r.name,
          role: r.role as PersonRole,
          teamId: opt(r.teamId),
          timezone: r.timezone,
          workHours: r.workHours,
          skills: r.skills,
          areas: r.areas,
          active: r.active,
        }),
      );
    },

    async absences() {
      const rows = await run((tx) => tx.select().from(absences).where(and(eq(absences.orgId, orgId), isNull(absences.cancelledAt))));
      return rows.map((r): Absence => ({ personId: r.personId, startsAt: r.startsAt, endsAt: r.endsAt, kind: r.kind as AbsenceKind, inferred: r.inferred }));
    },

    async latestDailyNote(personId) {
      const [r] = await run((tx) =>
        tx
          .select()
          .from(dailyNotes)
          .where(and(eq(dailyNotes.orgId, orgId), eq(dailyNotes.personId, personId), inArray(dailyNotes.state, ["confirmed", "auto_unreviewed"])))
          .orderBy(desc(dailyNotes.date))
          .limit(1),
      );
      if (!r) return null;
      return {
        personId: r.personId,
        date: r.date,
        stoppedAt: opt(r.stoppedAt),
        blocked: opt(r.blocked),
        released: r.released.map(mark),
        reserved: r.reserved.map(mark),
        state: r.state as DailyNoteState,
        confirmedAt: opt(r.confirmedAt),
      } satisfies DailyNote;
    },

    async task(key) {
      const [r] = await run((tx) => tx.select().from(tasks).where(and(eq(tasks.orgId, orgId), sql`upper(${tasks.key}) = upper(${key})`)));
      return r ? toTask(r) : null;
    },

    async tasks(filter) {
      const conds: SQL[] = [eq(tasks.orgId, orgId)];
      if (filter.assigneeId) conds.push(eq(tasks.assigneeId, filter.assigneeId));
      if (filter.openOnly) conds.push(inArray(tasks.state, OPEN_TASK_STATES));
      const rows = await run((tx) => tx.select().from(tasks).where(and(...conds)).orderBy(tasks.key).limit(100));
      return rows.map(toTask);
    },

    async pullRequests(filter) {
      const conds: SQL[] = [eq(pullRequests.orgId, orgId)];
      if (filter.number !== undefined) conds.push(eq(pullRequests.number, filter.number));
      if (filter.repository) conds.push(eq(pullRequests.repository, filter.repository));
      if (filter.branch) conds.push(eq(pullRequests.branch, filter.branch));
      if (filter.authorId) conds.push(eq(pullRequests.authorId, filter.authorId));
      if (filter.taskKey) conds.push(sql`upper(${pullRequests.taskKey}) = upper(${filter.taskKey})`);
      if (filter.openOnly) conds.push(inArray(pullRequests.state, OPEN_PR_STATES));
      const rows = await run((tx) => tx.select().from(pullRequests).where(and(...conds)).orderBy(desc(pullRequests.openedAt)).limit(100));
      return rows.map(toPr);
    },

    async lastCommitAt(repository, branch) {
      const [r] = await run((tx) =>
        tx
          .select({ at: workEvents.occurredAt })
          .from(workEvents)
          .where(and(eq(workEvents.orgId, orgId), eq(workEvents.type, "commit"), eq(workEvents.repository, repository), eq(workEvents.branch, branch)))
          .orderBy(desc(workEvents.occurredAt))
          .limit(1),
      );
      return r?.at ?? null;
    },

    async events(filter) {
      const conds: SQL[] = [eq(workEvents.orgId, orgId), gte(workEvents.occurredAt, filter.since)];
      if (filter.personId) conds.push(eq(workEvents.personId, filter.personId));
      const rows = await run((tx) =>
        tx
          .select()
          .from(workEvents)
          .where(and(...conds))
          .orderBy(desc(workEvents.occurredAt))
          .limit(Math.min(filter.limit ?? 200, 500)),
      );
      return rows.map(
        (r): WorkEvent => ({
          type: r.type as WorkEventType,
          personId: opt(r.personId),
          repository: opt(r.repository),
          branch: opt(r.branch),
          prNumber: opt(r.prNumber),
          taskKey: opt(r.taskKey),
          occurredAt: r.occurredAt,
          source: r.source as WorkEvent["source"],
          sourceRef: r.sourceRef,
          ...(r.data ? { data: r.data as Record<string, unknown> } : {}),
        }),
      );
    },

    async contributions(since) {
      const rows = await run((tx) => tx.select().from(contributions).where(and(eq(contributions.orgId, orgId), gte(contributions.occurredAt, since))));
      return rows.map(
        (r): Contribution => ({
          helperId: r.helperId,
          helpedId: r.helpedId,
          kind: r.kind as ContributionKind,
          confirmed: r.confirmed,
          occurredAt: r.occurredAt,
          ...(r.deliveryRef ? { deliveryRef: r.deliveryRef } : {}),
        }),
      );
    },
  };
}
