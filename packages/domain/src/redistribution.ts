// Redistribuição (etapa 11, F6). Puras: recebem `now`, sem relógio, rede nem modelo.
// Montam os candidatos com a calculadora de carga, conferem o ajuste da líder com as mesmas regras do plano,
// e decidem o que volta para quem retornou. O plano em si sai de `planOptions` (rules.ts).
import { capacityCard, type PlanInput, RULES } from "./rules.ts";
import { addDays, DAY, endOfLocalDay, zonedTime } from "./time.ts";
import type { Absence, Person, PullRequest, Task } from "./types.ts";

const OPEN: ReadonlySet<Task["state"]> = new Set(["backlog", "todo", "in_progress", "in_review"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ausência registrada no painel com datas locais de quem se ausenta: do início do primeiro dia ao fim do
 * último, no fuso dela (não no de quem registra). Null se as datas forem inválidas.
 */
export function absenceRange(startDate: string, endDate: string, timezone: string): { startsAt: Date; endsAt: Date } | null {
  if (!DATE.test(startDate) || !DATE.test(endDate) || endDate < startDate) return null;
  const startsAt = zonedTime(startDate, "00:00", timezone);
  const endsAt = zonedTime(addDays(endDate, 1), "00:00", timezone);
  return Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) ? null : { startsAt, endsAt };
}

/** Quem registra ausência no painel: a própria pessoa, ou a liderança da equipe dela. */
export function canRegisterAbsence(by: Person, person: Person): boolean {
  return by.active && (by.id === person.id || (by.role === "leader" && by.teamId !== undefined && by.teamId === person.teamId));
}

/** Quem aprova o plano: a liderança da equipe de quem se ausenta, nunca a própria pessoa ausente. */
export function canApprovePlan(by: Person, absent: Person, teamLeaderId?: string): boolean {
  if (!by.active || by.id === absent.id || by.role !== "leader") return false;
  return by.id === teamLeaderId || (by.teamId !== undefined && by.teamId === absent.teamId);
}

/**
 * Candidatos de `planOptions`: colegas ativos da mesma equipe (sem RH e sem a pessoa ausente), com a carga
 * da calculadora, as ausências e a conta no Linear. Sempre na mesma ordem para os mesmos dados.
 */
export function planCandidates(input: {
  absentId: string;
  people: Person[];
  tasks: Task[];
  pullRequests: PullRequest[];
  absences: Absence[];
  linearAccounts: ReadonlySet<string>;
  teamLimit: (teamId: string | undefined) => number;
  now: Date;
}): PlanInput["candidates"] {
  const absent = input.people.find((p) => p.id === input.absentId);
  return input.people
    .filter((p) => p.active && p.role !== "hr" && p.id !== input.absentId && (!absent?.teamId || p.teamId === absent.teamId))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((person) => {
      const absences = input.absences.filter((a) => a.personId === person.id);
      const card = capacityCard({
        person,
        openTasks: input.tasks.filter((t) => t.assigneeId === person.id && OPEN.has(t.state)),
        pendingReviews: input.pullRequests.filter((pr) => (pr.state === "open" || pr.state === "draft") && pr.reviewerIds.includes(person.id)).length,
        absences,
        adjustment: 0,
        teamLimit: input.teamLimit(person.teamId),
        now: input.now,
      });
      return { person, card, absences, hasLinearAccount: input.linearAccounts.has(person.id) };
    });
}

export type PlanTarget = { kind: "task"; task: Task } | { kind: "review"; pr: PullRequest };

/**
 * Ajuste da líder: as regras que não se negociam continuam valendo. Pessoa ativa da equipe, não ausente até o
 * prazo, com conta no Linear se a tarefa é do Linear; revisão nunca para o autor do PR. Passar do limite é
 * decisão da líder, e volta como aviso.
 */
export function adjustmentCheck(target: PlanTarget, to: PlanInput["candidates"][number] | undefined, now: Date): { ok: true; overLimit: boolean } | { ok: false; reason: string } {
  if (!to || !to.person.active) return { ok: false, reason: "pessoa fora da equipe ou inativa" };
  const away = (until: Date) => to.absences.some((a) => a.startsAt.getTime() < until.getTime() && a.endsAt.getTime() > now.getTime());
  if (target.kind === "task") {
    if (target.task.hasLinearId && !to.hasLinearAccount) return { ok: false, reason: "sem conta no Linear" };
    const until = target.task.dueDate ? endOfLocalDay(target.task.dueDate, to.person.timezone) : new Date(now.getTime() + RULES.capacityWindowDays * DAY);
    if (away(until)) return { ok: false, reason: "ausente antes do prazo" };
    return { ok: true, overLimit: to.card.load + (target.task.size ?? RULES.unsizedTaskPoints) > to.card.limit };
  }
  if (target.pr.authorId === to.person.id) return { ok: false, reason: "é quem escreveu o PR" };
  if (away(new Date(now.getTime() + RULES.reviewerAbsenceFreeDays * DAY))) return { ok: false, reason: "ausente nos próximos 14 dias" };
  return { ok: true, overLimit: to.card.load + RULES.reviewPoints > to.card.limit };
}

/** Tarefas novas da pessoa ausente, ainda abertas e fora dos planos da ausência: plano complementar. */
export function complementTasks(absentId: string, tasks: Task[], plannedTaskIds: ReadonlySet<string>): Task[] {
  return tasks.filter((t) => t.assigneeId === absentId && OPEN.has(t.state) && !plannedTaskIds.has(t.id));
}

export interface PassedItem {
  itemId: string;
  taskId: string;
  /** Quem recebeu durante a ausência. */
  holderId: string;
}

/**
 * Na volta: o que foi passado e segue aberto com quem recebeu pode voltar. A líder decide; o plano só propõe.
 * Tarefa concluída, trocada de novo de responsável ou fechada fica onde está.
 */
export function returnProposals(passed: PassedItem[], tasks: Task[], returnedId: string): { itemId: string; taskId: string; fromId: string; toId: string; reason: string }[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return passed
    .filter((p) => {
      const t = byId.get(p.taskId);
      return t !== undefined && OPEN.has(t.state) && t.assigneeId === p.holderId && p.holderId !== returnedId;
    })
    .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
    .map((p) => ({ itemId: p.itemId, taskId: p.taskId, fromId: p.holderId, toId: returnedId, reason: "Voltou da ausência; a tarefa segue aberta com quem a recebeu." }));
}
