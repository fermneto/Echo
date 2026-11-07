// Regras fixas (aba Regras e Calculadoras). Frente: Funções implementa e testa.
// Mesma entrada, mesma saída. Recebem `now` explícito (do Clock), nunca leem a hora do sistema.
// Os números que o agente cita saem daqui; o modelo só redige.
import { addDays, coveredMs, DAY, endOfLocalDay, localDate, weekdayOf, zonedParts, zonedTime } from "./time.ts";
import type { Absence, BranchMark, Contribution, DailyNote, Person, PullRequest, SourceRef, Task, WorkEvent } from "./types.ts";

/** Pesos e limites iniciais. São pontos de partida configuráveis (aba Regras). */
export const RULES = {
  releaseValidDays: 7,
  activeCommitDays: 7,
  unsizedTaskPoints: 2,
  reviewPoints: 0.5,
  dueSoonDays: 3,
  duePoints: 1,
  capacityWindowDays: 7,
  reviewerAbsenceFreeDays: 14,
  topicWeights: { pr_merged: 3, help: 3, review: 2, task_done: 1, profile: 1 },
  topicRecentDays: 90,
  topicOldDays: 365,
  topicMax: 3,
  cost: { stopFixes: 0.8, rulesOnly: 1, hardLimit: 2 },
} as const;

const OPEN_TASK: ReadonlySet<Task["state"]> = new Set(["backlog", "todo", "in_progress", "in_review"]);
const round1 = (n: number) => Math.round(n * 10) / 10;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---------- Disponibilidade
export interface AwayResult {
  away: boolean;
  reason?: "off_hours" | "absence" | "weekend";
  /** Próximo início de expediente fora de ausência. */
  returnsAt?: Date;
}

const activeAbsence = (absences: Absence[], personId: string, at: Date) =>
  absences.find((a) => a.personId === personId && a.startsAt.getTime() <= at.getTime() && at.getTime() < a.endsAt.getTime());

/**
 * Ausente quando há ausência ativa, quando o dia local não é de trabalho ou quando a hora local está fora
 * do expediente. A volta é o próximo início de expediente que não cai numa ausência; se uma ausência
 * termina no meio do expediente, a volta é o fim dela.
 */
export function isAway(person: Person, absences: Absence[], now: Date): AwayResult {
  const tz = person.timezone;
  const { start, end, days } = person.workHours;
  const today = localDate(now, tz);
  const absence = activeAbsence(absences, person.id, now);
  let reason: AwayResult["reason"];
  if (absence) reason = "absence";
  else if (!days.includes(weekdayOf(today))) reason = "weekend";
  else {
    const p = zonedParts(now, tz);
    const minutes = p.hour * 60 + p.minute;
    const [sh, sm] = start.split(":").map(Number) as [number, number];
    const [eh, em] = end.split(":").map(Number) as [number, number];
    if (minutes < sh * 60 + sm || minutes >= eh * 60 + em) reason = "off_hours";
  }
  if (!reason) return { away: false };

  for (let i = 0; i <= 400; i++) {
    const date = addDays(today, i);
    if (!days.includes(weekdayOf(date))) continue;
    const dayStart = zonedTime(date, start, tz);
    const dayEnd = zonedTime(date, end, tz);
    if (dayEnd.getTime() <= now.getTime()) continue;
    let candidate = dayStart.getTime() > now.getTime() ? dayStart : now;
    // Pula ausências encadeadas dentro do mesmo expediente.
    for (let blocking = activeAbsence(absences, person.id, candidate); blocking; blocking = activeAbsence(absences, person.id, candidate)) {
      candidate = blocking.endsAt;
    }
    if (candidate.getTime() < dayEnd.getTime() && candidate.getTime() > now.getTime()) {
      return { away: true, reason, returnsAt: candidate };
    }
  }
  return { away: true, reason };
}

// ---------- Status de branch
export type BranchStatus = "released" | "reserved" | "in_progress" | "no_activity" | "unknown";
export interface BranchStatusResult {
  status: BranchStatus;
  mark?: BranchMark;
  sources: SourceRef[];
}
export interface BranchStatusInput {
  branch: string;
  note?: DailyNote;
  pr?: PullRequest;
  task?: Task;
  lastCommitAt?: Date;
  now: Date;
}

const noteSource = (note: DailyNote): SourceRef => ({
  label: `nota do dia de ${note.date} (${note.state === "confirmed" ? "confirmada" : note.state === "auto_unreviewed" ? "publicada sem conferência" : "rascunho"})`,
  ref: `daily_note:${note.personId}:${note.date}`,
});
const prSource = (pr: PullRequest): SourceRef => ({ label: `PR ${pr.number}`, ref: `github:pr/${pr.number}` });
const taskSource = (task: Task): SourceRef => ({ label: task.key, ref: `linear:${task.key}` });

/** Até quando a liberação vale: 7 dias depois da confirmação, ou até o fim do dia "until" (UTC), o que vier antes. */
function releaseExpiry(note: DailyNote, mark: BranchMark): number {
  const base = note.confirmedAt?.getTime() ?? Date.parse(`${note.date}T00:00:00Z`);
  const byDays = base + RULES.releaseValidDays * DAY;
  if (!mark.until) return byDays;
  const until = Date.parse(`${addDays(mark.until, 1)}T00:00:00Z`);
  return Number.isNaN(until) ? byDays : Math.min(byDays, until);
}

/**
 * Liberação vale 7 dias (ou até "until") e só de nota confirmada: auto_unreviewed mantém reservas e não libera.
 * Reserva vence liberação na mesma branch. Sem nota, o estado vem do PR, dos commits e da tarefa.
 */
export function branchStatus(input: BranchStatusInput): BranchStatusResult {
  const { branch, note, pr, task, lastCommitAt, now } = input;
  const published = note && (note.state === "confirmed" || note.state === "auto_unreviewed");
  if (note && published) {
    const reserved = note.reserved.find((m) => m.branch === branch);
    if (reserved) return { status: "reserved", mark: reserved, sources: [noteSource(note), ...(pr ? [prSource(pr)] : [])] };
    const released = note.released.find((m) => m.branch === branch);
    if (released && note.state === "confirmed" && now.getTime() < releaseExpiry(note, released)) {
      return { status: "released", mark: released, sources: [noteSource(note)] };
    }
  }

  const sources: SourceRef[] = [];
  if (pr) sources.push(prSource(pr));
  if (task) sources.push(taskSource(task));
  const recentCommit = lastCommitAt !== undefined && now.getTime() - lastCommitAt.getTime() <= RULES.activeCommitDays * DAY;
  const active = (pr && (pr.state === "open" || pr.state === "draft")) || recentCommit || (task && (task.state === "in_progress" || task.state === "in_review"));
  if (active) return { status: "in_progress", sources };
  if (pr || task || lastCommitAt) return { status: "no_activity", sources };
  return { status: "unknown", sources: [] };
}

// ---------- Carga
export interface CapacityCard {
  personId: string;
  load: number;
  limit: number;
  slack: number; // limit - load
  areas: string[];
  overLimit: boolean;
}
export interface CapacityInput {
  person: Person;
  openTasks: Task[];
  pendingReviews: number;
  absences: Absence[];
  adjustment: number;
  teamLimit: number;
  now: Date;
}

/**
 * carga = tamanhos abertos (sem tamanho = 2) + revisões × 0,5 + 1 por prazo em até 3 dias + ajustes
 * limite = limite da equipe × parte dos próximos 7 dias sem ausência
 * A ausência reduz o limite, não a carga. Prazo vencido também conta como prazo próximo.
 */
export function capacityCard(input: CapacityInput): CapacityCard {
  const { person, now } = input;
  const open = input.openTasks.filter((t) => OPEN_TASK.has(t.state));
  const today = localDate(now, person.timezone);
  const soon = addDays(today, RULES.dueSoonDays);
  const sizes = open.reduce((s, t) => s + (t.size ?? RULES.unsizedTaskPoints), 0);
  const dueSoon = open.filter((t) => t.dueDate !== undefined && t.dueDate <= soon).length;
  const load = round1(sizes + input.pendingReviews * RULES.reviewPoints + dueSoon * RULES.duePoints + input.adjustment);

  const windowEnd = new Date(now.getTime() + RULES.capacityWindowDays * DAY);
  const mine = input.absences.filter((a) => a.personId === person.id).map((a) => ({ start: a.startsAt, end: a.endsAt }));
  const freeShare = 1 - coveredMs(mine, now, windowEnd) / (windowEnd.getTime() - now.getTime());
  const limit = round1(input.teamLimit * freeShare);
  return { personId: person.id, load, limit, slack: round1(limit - load), areas: [...person.areas], overLimit: load > limit };
}

// ---------- Redistribuição
export interface PlanAssignment {
  taskId?: string;
  prId?: string;
  fromId: string;
  toId?: string; // ausente = não coube
  reason: string; // escrito por regra
}
export interface PlanOptionsResult {
  assignments: PlanAssignment[];
  unassigned: PlanAssignment[];
}
export interface PlanInput {
  absentId: string;
  tasks: Task[];
  reviews: PullRequest[];
  candidates: { person: Person; card: CapacityCard; absences: Absence[]; hasLinearAccount: boolean }[];
  now: Date;
}

type Candidate = PlanInput["candidates"][number];

const overlaps = (absences: Absence[], personId: string, from: Date, to: Date) =>
  absences.some((a) => a.personId === personId && a.startsAt.getTime() < to.getTime() && a.endsAt.getTime() > from.getTime());

/** Área da tarefa: o campo, ou a primeira etiqueta que casa com áreas ou skills de quem está ativo. */
function taskArea(task: Task, candidates: Candidate[]): string | undefined {
  if (task.area) return task.area;
  const known = new Set(candidates.filter((c) => c.person.active).flatMap((c) => [...c.person.areas, ...c.person.skills]));
  return task.labels.find((l) => known.has(l));
}

/** Ordem estável dos candidatos: mais folga primeiro, depois nome e id. */
const bySlack = (load: Map<string, number>) => (a: Candidate, b: Candidate) =>
  a.card.limit - (load.get(a.person.id) ?? 0) === b.card.limit - (load.get(b.person.id) ?? 0)
    ? byText(a.person.name, b.person.name) || byText(a.person.id, b.person.id)
    : b.card.limit - (load.get(b.person.id) ?? 0) - (a.card.limit - (load.get(a.person.id) ?? 0));

/**
 * Ordena por prazo. Candidatos sem ausência até o prazo e sem passar do limite, priorizando a área e depois a
 * skill; entre eles, quem tem mais folga. Tarefa do Linear só vai para quem tem conta lá. Se ninguém couber,
 * fica sem responsável, com o motivo. Sempre o mesmo resultado para os mesmos dados.
 * As revisões da pessoa ausente entram depois das tarefas, pela regra de planReviewers.
 */
export function planOptions(input: PlanInput): PlanOptionsResult {
  const { absentId, now } = input;
  const pool = input.candidates.filter((c) => c.person.active && c.person.id !== absentId);
  const load = new Map(pool.map((c) => [c.person.id, c.card.load]));
  const assignments: PlanAssignment[] = [];
  const unassigned: PlanAssignment[] = [];

  const tasks = input.tasks
    .filter((t) => OPEN_TASK.has(t.state))
    .sort((a, b) => byText(a.dueDate ?? "9999-99-99", b.dueDate ?? "9999-99-99") || byText(a.key, b.key));

  for (const task of tasks) {
    const size = task.size ?? RULES.unsizedTaskPoints;
    const area = taskArea(task, pool);
    const fits = (c: Candidate) => {
      const until = task.dueDate ? endOfLocalDay(task.dueDate, c.person.timezone) : new Date(now.getTime() + RULES.capacityWindowDays * DAY);
      return !overlaps(c.absences, c.person.id, now, until) && (load.get(c.person.id) ?? 0) + size <= c.card.limit;
    };
    const withRoom = pool.filter(fits);
    const eligible = withRoom.filter((c) => !task.hasLinearId || c.hasLinearAccount);
    const ranked = [
      ...eligible.filter((c) => area !== undefined && c.person.areas.includes(area)).sort(bySlack(load)),
      ...eligible.filter((c) => area !== undefined && !c.person.areas.includes(area) && c.person.skills.includes(area)).sort(bySlack(load)),
      ...eligible.filter((c) => area === undefined || (!c.person.areas.includes(area) && !c.person.skills.includes(area))).sort(bySlack(load)),
    ];
    const chosen = ranked[0];
    if (!chosen) {
      unassigned.push({
        taskId: task.id,
        fromId: absentId,
        reason: withRoom.length > 0 ? "Ninguém com folga tem conta no Linear: fica sem responsável." : "Ninguém tem folga até o prazo: adiar, reduzir ou chamar outra equipe.",
      });
      continue;
    }
    load.set(chosen.person.id, (load.get(chosen.person.id) ?? 0) + size);
    const reason =
      area === undefined
        ? "Sem área definida, escolhida pela folga."
        : chosen.person.areas.includes(area)
          ? `Atua em ${area} e tem folga.`
          : chosen.person.skills.includes(area)
            ? `Tem a skill ${area} e tem folga.`
            : `Ninguém de ${area} tem folga; escolhida pela folga.`;
    assignments.push({ taskId: task.id, fromId: absentId, toId: chosen.person.id, reason });
  }

  // As revisões consideram a carga já somada pelas tarefas acima.
  const adjusted = pool.map((c) => ({ ...c, card: { ...c.card, load: load.get(c.person.id) ?? c.card.load } }));
  for (const a of planReviewers({ ...input, candidates: adjusted })) (a.toId ? assignments : unassigned).push(a);
  return { assignments, unassigned };
}

/** Revisões da pessoa ausente: quem tem mais folga, sem ausência nos próximos 14 dias, nunca o autor do PR. */
export function planReviewers(input: PlanInput): PlanAssignment[] {
  const { absentId, now } = input;
  const horizon = new Date(now.getTime() + RULES.reviewerAbsenceFreeDays * DAY);
  const pool = input.candidates.filter((c) => c.person.active && c.person.id !== absentId);
  const load = new Map(pool.map((c) => [c.person.id, c.card.load]));
  const out: PlanAssignment[] = [];
  const prs = input.reviews
    .filter((p) => (p.state === "open" || p.state === "draft") && p.reviewerIds.includes(absentId))
    .sort((a, b) => byText(a.repository, b.repository) || a.number - b.number);
  for (const pr of prs) {
    const eligible = pool
      .filter((c) => c.person.id !== pr.authorId && !pr.reviewerIds.includes(c.person.id))
      .filter((c) => !overlaps(c.absences, c.person.id, now, horizon))
      .filter((c) => (load.get(c.person.id) ?? 0) + RULES.reviewPoints <= c.card.limit)
      .sort(bySlack(load));
    const chosen = eligible[0];
    if (!chosen) {
      out.push({ prId: pr.id, fromId: absentId, reason: "Ninguém com folga e sem ausência nos próximos 14 dias para revisar." });
      continue;
    }
    load.set(chosen.person.id, (load.get(chosen.person.id) ?? 0) + RULES.reviewPoints);
    out.push({ prId: pr.id, fromId: absentId, toId: chosen.person.id, reason: "Revisão para quem tem mais folga." });
  }
  return out;
}

// ---------- Relatório semanal
export interface WeeklyMetrics {
  deliveries: number;
  commits: number;
  reviews: number;
  helps: number;
  delays: { taskKey: string; cause?: string }[];
}

/**
 * Período [from, to). PR ligado e conclusão da tarefa são uma entrega só. Ajuda conta só confirmada.
 * Atraso: tarefa da pessoa com prazo dentro do período, concluída depois do prazo ou ainda aberta.
 * O prazo vale até o fim do dia (UTC aqui: o fuso da pessoa não faz parte da entrada).
 */
export function weeklyMetrics(input: { personId: string; events: WorkEvent[]; contributions: Contribution[]; tasks: Task[]; from: Date; to: Date }): WeeklyMetrics {
  const { personId, from, to } = input;
  const inWindow = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime();
  const mine = input.events.filter((e) => e.personId === personId && inWindow(e.occurredAt));

  const delivered = new Set<string>();
  for (const e of mine) {
    if (e.type === "task_done" && e.taskKey) delivered.add(`task:${e.taskKey}`);
    if (e.type === "pr_merged") delivered.add(e.taskKey ? `task:${e.taskKey}` : `pr:${e.repository ?? ""}#${e.prNumber ?? e.sourceRef}`);
  }

  const doneAt = new Map<string, Date>();
  for (const e of input.events) {
    if (e.type === "task_done" && e.taskKey && (!doneAt.has(e.taskKey) || e.occurredAt < doneAt.get(e.taskKey)!)) doneAt.set(e.taskKey, e.occurredAt);
  }
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  const delays = input.tasks
    .filter((t) => t.assigneeId === personId && t.dueDate !== undefined && t.dueDate >= fromDate && t.dueDate < toDate && t.state !== "canceled")
    .filter((t) => {
      const deadline = Date.parse(`${addDays(t.dueDate!, 1)}T00:00:00Z`);
      const done = doneAt.get(t.key);
      return done ? done.getTime() >= deadline : t.state !== "done" && deadline <= to.getTime();
    })
    .sort((a, b) => byText(a.key, b.key))
    .map((t) => ({ taskKey: t.key }));

  return {
    deliveries: delivered.size,
    commits: mine.filter((e) => e.type === "commit").length,
    reviews: mine.filter((e) => e.type === "review").length,
    helps: input.contributions.filter((c) => c.helperId === personId && c.confirmed && inWindow(c.occurredAt)).length,
    delays,
  };
}

/** Coautoria, mudança pedida em revisão e destravamento valem crédito forte; confirmação e reação, médio. */
export function contributionScore(c: Contribution): { weight: "forte" | "medio" } {
  return { weight: c.kind === "coauthor" || c.kind === "review_change" || c.kind === "unblock" ? "forte" : "medio" };
}

// ---------- Quem sabe
export interface TopicEvidence {
  personId: string;
  kind: "pr_merged" | "help" | "review" | "task_done" | "profile";
  at: Date;
  source: SourceRef;
}
export interface TopicCandidate {
  personId: string;
  score: number;
  status: "available" | "over_limit" | "vacation";
  evidence: SourceRef[];
}

const STATUS_ORDER: Record<TopicCandidate["status"], number> = { available: 0, over_limit: 1, vacation: 2 };

/**
 * pontuação = Σ pesos (PR 3, ajuda 3, revisão 2, tarefa 1, perfil 1) × recência (1 ≤ 90d, 0,5 ≤ 1 ano, 0 depois). Até 3 pessoas.
 * Quem chama já filtra a evidência pelo que quem pergunta pode ver. A ordem vale só para esta pergunta.
 */
export function peopleForTopic(input: { evidence: TopicEvidence[]; people: Person[]; status: Record<string, TopicCandidate["status"]>; excluded: string[]; now: Date }): TopicCandidate[] {
  const active = new Map(input.people.filter((p) => p.active).map((p) => [p.id, p]));
  const excluded = new Set(input.excluded);
  const byPerson = new Map<string, { score: number; evidence: TopicEvidence[] }>();
  for (const e of input.evidence) {
    if (!active.has(e.personId) || excluded.has(e.personId)) continue;
    const ageDays = (input.now.getTime() - e.at.getTime()) / DAY;
    const recency = ageDays <= RULES.topicRecentDays ? 1 : ageDays <= RULES.topicOldDays ? 0.5 : 0;
    if (recency === 0) continue;
    const entry = byPerson.get(e.personId) ?? { score: 0, evidence: [] };
    entry.score += RULES.topicWeights[e.kind] * recency;
    entry.evidence.push(e);
    byPerson.set(e.personId, entry);
  }
  return [...byPerson.entries()]
    .map(([personId, { score, evidence }]) => {
      const seen = new Set<string>();
      const sources = evidence
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .map((e) => e.source)
        .filter((s) => (seen.has(s.ref) ? false : (seen.add(s.ref), true)));
      return { personId, score: round1(score), status: input.status[personId] ?? "available", evidence: sources };
    })
    .sort((a, b) => b.score - a.score || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byText(active.get(a.personId)!.name, active.get(b.personId)!.name))
    .slice(0, RULES.topicMax);
}

// ---------- Custo
export type CostLevel = "normal" | "stop_fixes" | "rules_only" | "hard_limit";
/** 80%: param correção e vídeos · 100%: só regras (ausentes seguem) · 200%: ausentes sem IA. */
export function costLevel(spentUsd: number, monthlyLimitUsd: number): CostLevel {
  if (!(monthlyLimitUsd > 0)) return spentUsd > 0 ? "hard_limit" : "rules_only";
  const ratio = spentUsd / monthlyLimitUsd;
  if (ratio >= RULES.cost.hardLimit) return "hard_limit";
  if (ratio >= RULES.cost.rulesOnly) return "rules_only";
  if (ratio >= RULES.cost.stopFixes) return "stop_fixes";
  return "normal";
}
