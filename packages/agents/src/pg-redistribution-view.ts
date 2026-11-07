// Leitura da Redistribuição para o painel: planos esperando a liderança e os decididos há pouco, com o rótulo de
// cada item e a carga de quem recebe (a mesma calculadora do plano). Só leitura; decidir passa pelo fluxo.
import { type Database, pullRequests, redistributionPlans, tasks, withOrg } from "@echo/db";
import { canApprovePlan, canRegisterAbsence, type Person, planCandidates } from "@echo/domain";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import { createPgAgentData } from "./pg-data.ts";
import { createPgRedistributionStore } from "./pg-redistribution.ts";
import { absenceTitle, type ItemState, type PlanState, type PlanTrigger, type StoredRedistribution } from "./redistribution.ts";

const DAY = 86_400_000;

export interface PanelPlanItem {
  id: string;
  kind: "task" | "review";
  /** "ECH-133" ou "PR 36". */
  label: string;
  title: string;
  toId?: string;
  toName?: string;
  reason: string;
  state: ItemState;
  /** Carga atual de quem recebe, em pontos, pela calculadora de carga. */
  load?: { load: number; limit: number };
}

export interface PanelPlan {
  id: string;
  trigger: PlanTrigger;
  state: PlanState;
  title: string;
  absentName: string;
  createdAt: Date;
  approvedByName?: string;
  decidedAt?: Date;
  items: PanelPlanItem[];
}

export interface RedistributionPanel {
  plans: PanelPlan[];
  /** Quem esta pessoa pode registrar como ausente (ela mesma fica de fora: o plano dela é de outra liderança). */
  people: { id: string; name: string }[];
}

type PlanRow = { id: string; createdAt: Date; approvedAt: Date | null };

async function planRows(db: Database, orgId: string, now: Date, recentDays: number, limit: number, onlyAwaiting: boolean): Promise<PlanRow[]> {
  const since = new Date(now.getTime() - recentDays * DAY);
  const where = onlyAwaiting
    ? eq(redistributionPlans.state, "awaiting_leader")
    : or(eq(redistributionPlans.state, "awaiting_leader"), gte(redistributionPlans.approvedAt, since));
  return withOrg(db, orgId, (tx) =>
    tx
      .select({ id: redistributionPlans.id, createdAt: redistributionPlans.createdAt, approvedAt: redistributionPlans.approvedAt })
      .from(redistributionPlans)
      .where(and(eq(redistributionPlans.orgId, orgId), where))
      .orderBy(desc(redistributionPlans.createdAt), desc(redistributionPlans.id))
      .limit(limit),
  );
}

/** Planos que a pessoa pode decidir (liderança da equipe de quem se ausenta), com o título por regra. */
async function visiblePlans(db: Database, orgId: string, by: string, rows: PlanRow[], people: Person[]) {
  const store = createPgRedistributionStore(db, orgId);
  const me = people.find((p) => p.id === by);
  if (!me) return [];
  const leaders = new Map<string, string | null>();
  const out: { plan: StoredRedistribution; row: PlanRow; title: string; absent: Person }[] = [];
  for (const row of rows) {
    const plan = await store.get(row.id);
    const absent = plan ? people.find((p) => p.id === plan.absentId) : undefined;
    if (!plan || !absent) continue;
    if (absent.teamId && !leaders.has(absent.teamId)) leaders.set(absent.teamId, await store.teamLeader(absent.teamId));
    if (!canApprovePlan(me, absent, (absent.teamId && leaders.get(absent.teamId)) || undefined)) continue;
    const absence = plan.absenceId ? await store.absence(plan.absenceId) : null;
    out.push({ plan, row, title: absenceTitle(absent, people, absence, plan.trigger), absent });
  }
  return out;
}

const firstName = (p: Person | undefined) => (p ? (p.name.trim().split(/\s+/)[0] ?? p.name) : undefined);

/** Painel da Redistribuição para quem lidera. */
export async function readRedistributionPanel(db: Database, orgId: string, by: string, now: Date, opts: { recentDays?: number; limit?: number } = {}): Promise<RedistributionPanel> {
  const data = createPgAgentData(db, orgId);
  const [people, openTasks, openPrs, absences, settings] = await Promise.all([data.people(), data.tasks({ openOnly: true }), data.pullRequests({ openOnly: true }), data.absences(), data.orgSettings()]);
  const me = people.find((p) => p.id === by);
  const registrable = me ? people.filter((p) => p.id !== by && p.active && p.role !== "hr" && canRegisterAbsence(me, p)).map((p) => ({ id: p.id, name: p.name })) : [];

  const rows = await planRows(db, orgId, now, opts.recentDays ?? 7, opts.limit ?? 10, false);
  const plans = await visiblePlans(db, orgId, by, rows, people);
  if (plans.length === 0) return { plans: [], people: registrable };

  // Rótulos de tarefas e PRs, inclusive os que já fecharam depois do plano.
  const taskIds = [...new Set(plans.flatMap((p) => p.plan.items.flatMap((i) => (i.taskId ? [i.taskId] : []))))];
  const prIds = [...new Set(plans.flatMap((p) => p.plan.items.flatMap((i) => (i.prId ? [i.prId] : []))))];
  const [taskRows, prRows] = await withOrg(db, orgId, async (tx) => [
    taskIds.length ? await tx.select({ id: tasks.id, key: tasks.key, title: tasks.title }).from(tasks).where(and(eq(tasks.orgId, orgId), inArray(tasks.id, taskIds))) : [],
    prIds.length ? await tx.select({ id: pullRequests.id, number: pullRequests.number, title: pullRequests.title }).from(pullRequests).where(and(eq(pullRequests.orgId, orgId), inArray(pullRequests.id, prIds))) : [],
  ] as const);
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const prById = new Map(prRows.map((p) => [p.id, p]));

  // Carga de quem recebe: os mesmos candidatos do plano, por pessoa ausente.
  const linear = await createPgRedistributionStore(db, orgId).linearAccounts();
  const loads = new Map<string, Map<string, { load: number; limit: number }>>();
  const loadsFor = (absentId: string) => {
    let m = loads.get(absentId);
    if (!m) {
      const candidates = planCandidates({ absentId, people, tasks: openTasks, pullRequests: openPrs, absences, linearAccounts: linear, teamLimit: (team) => (team ? settings.teamLoadLimits[team] : undefined) ?? 12, now });
      m = new Map(candidates.map((c) => [c.person.id, { load: c.card.load, limit: c.card.limit }]));
      loads.set(absentId, m);
    }
    return m;
  };

  return {
    people: registrable,
    plans: plans.map(({ plan, row, title, absent }): PanelPlan => {
      const approver = plan.approvedBy ? people.find((p) => p.id === plan.approvedBy) : undefined;
      return {
        id: plan.id,
        trigger: plan.trigger,
        state: plan.state,
        title,
        absentName: firstName(absent) ?? absent.name,
        createdAt: row.createdAt,
        ...(approver ? { approvedByName: firstName(approver)! } : {}),
        ...(row.approvedAt ? { decidedAt: row.approvedAt } : {}),
        items: plan.items.map((i): PanelPlanItem => {
          const task = i.taskId ? taskById.get(i.taskId) : undefined;
          const pr = i.prId ? prById.get(i.prId) : undefined;
          const to = i.toId ? people.find((p) => p.id === i.toId) : undefined;
          const load = i.toId ? loadsFor(plan.absentId).get(i.toId) : undefined;
          return {
            id: i.id,
            kind: i.taskId ? "task" : "review",
            label: i.taskId ? (task?.key ?? "Tarefa") : `PR ${pr?.number ?? "?"}`,
            title: i.taskId ? (task?.title ?? "Tarefa") : `Revisão do PR ${pr?.number ?? "?"}`,
            ...(to ? { toId: to.id, toName: firstName(to)! } : {}),
            reason: i.reason,
            state: i.state,
            ...(load ? { load } : {}),
          };
        }),
      };
    }),
  };
}

/** Planos esperando a decisão desta pessoa, para "Aguardando você" e Meu plano. Sem carga nem rótulos. */
export async function awaitingPlansFor(db: Database, orgId: string, by: string, now: Date): Promise<{ id: string; title: string; createdAt: Date; items: number }[]> {
  const rows = await planRows(db, orgId, now, 0, 10, true);
  if (rows.length === 0) return [];
  const people = await createPgAgentData(db, orgId).people();
  return (await visiblePlans(db, orgId, by, rows, people)).map(({ plan, row, title }) => ({ id: plan.id, title, createdAt: row.createdAt, items: plan.items.length }));
}
