// Regras da nota do dia (etapa 8, F3). Puras: recebem `now`, sem relógio, rede nem modelo.
// O modelo só redige "onde parou"; o que travou sai daqui, e só a pessoa declara liberado e reservado.
import { isAway, releaseExpiry } from "./rules.ts";
import { DAY, HOUR, localDate, weekdayOf, zonedTime } from "./time.ts";
import type { Absence, BranchMark, DailyNote, DailyNoteState, Person, PullRequest, Task, WorkEvent } from "./types.ts";

export const NOTE_RULES = {
  /** Sem resposta neste prazo, o rascunho vira `auto_unreviewed`. */
  confirmHours: 2,
  /** Sem evento neste intervalo, não há rascunho e a nota anterior continua valendo. */
  quietHours: 24,
  /** Janela depois do fim do expediente em que a agenda ainda cria o rascunho (worker parado, reinício). */
  windowHours: 3,
  /** PR aberto há mais que isto sem revisão aparece como travado. */
  waitingReviewHours: 24,
  blockedLabels: ["bloqueado", "bloqueada", "blocked", "impedido", "impedida"],
} as const;

// ---------- Agenda do fim do expediente

export interface EndOfDayDue {
  /** Data local da pessoa (AAAA-MM-DD): com o id da pessoa, é a chave única do rascunho. */
  date: string;
  endsAt: Date;
}

/**
 * O fim do expediente de hoje (no fuso da pessoa) já passou, há menos de `windowHours`? Fim de semana,
 * ausência no fim do expediente, pessoa inativa ou do RH: sem rascunho.
 */
export function endOfDayDue(person: Person, absences: Absence[], now: Date): EndOfDayDue | null {
  if (!person.active || person.role === "hr") return null;
  const tz = person.timezone;
  // O expediente pode terminar depois da meia-noite em UTC; olha hoje e ontem no fuso da pessoa.
  for (const date of [localDate(now, tz), localDate(new Date(now.getTime() - DAY), tz)]) {
    if (!person.workHours.days.includes(weekdayOf(date))) continue;
    const endsAt = zonedTime(date, person.workHours.end, tz);
    const since = now.getTime() - endsAt.getTime();
    if (since < 0 || since >= NOTE_RULES.windowHours * HOUR) continue;
    // Ausente um minuto antes do fim (férias, licença): não há expediente para resumir.
    const before = new Date(endsAt.getTime() - 60_000);
    if (isAway(person, absences, before).reason === "absence") return null;
    return { date, endsAt };
  }
  return null;
}

/** Algum evento da pessoa nas últimas 24 horas? Sem isso, não há rascunho nem mensagem. */
export function hasRecentActivity(events: WorkEvent[], personId: string, now: Date): boolean {
  const from = now.getTime() - NOTE_RULES.quietHours * HOUR;
  return events.some((e) => e.personId === personId && e.occurredAt.getTime() > from && e.occurredAt.getTime() <= now.getTime());
}

// ---------- O que travou

export type NoteBlocker =
  | { kind: "pr_waiting_review"; pr: PullRequest; hasReviewers: boolean }
  | { kind: "task_overdue"; task: Task }
  | { kind: "task_blocked_label"; task: Task };

/**
 * Por regra, nunca pelo modelo: PR aberto da pessoa há mais de 24 h sem revisão, tarefa dela vencida
 * (no fuso dela) e tarefa marcada como bloqueada. Sem horários nem tempo trabalhado.
 */
export function noteBlockers(input: { person: Person; tasks: Task[]; pullRequests: PullRequest[]; events: WorkEvent[]; now: Date }): NoteBlocker[] {
  const { person, now } = input;
  const out: NoteBlocker[] = [];
  const reviewed = new Set(
    input.events.filter((e) => (e.type === "review" || e.type === "review_comment") && e.prNumber !== undefined).map((e) => `${e.repository ?? ""}#${e.prNumber}`),
  );
  for (const pr of input.pullRequests) {
    if (pr.authorId !== person.id || pr.state !== "open" || !pr.openedAt) continue;
    if (now.getTime() - pr.openedAt.getTime() < NOTE_RULES.waitingReviewHours * HOUR) continue;
    if (reviewed.has(`${pr.repository}#${pr.number}`)) continue;
    out.push({ kind: "pr_waiting_review", pr, hasReviewers: pr.reviewerIds.length > 0 });
  }
  const today = localDate(now, person.timezone);
  const labels = new Set<string>(NOTE_RULES.blockedLabels);
  for (const task of input.tasks) {
    if (task.assigneeId !== person.id || task.state === "done" || task.state === "canceled") continue;
    if (task.labels.some((l) => labels.has(l.toLocaleLowerCase("pt-BR")))) out.push({ kind: "task_blocked_label", task });
    else if (task.dueDate && task.dueDate < today) out.push({ kind: "task_overdue", task });
  }
  return out;
}

// ---------- Liberado e reservado do rascunho

/**
 * O rascunho só traz o que a pessoa já declarou: reservas da última nota publicada (continuam até ela tirar)
 * e liberações ainda válidas de nota confirmada, com a data da confirmação original. Nada novo.
 */
export function carriedMarks(previous: DailyNote | null, now: Date): { released: BranchMark[]; reserved: BranchMark[] } {
  if (!previous || previous.state === "draft") return { released: [], reserved: [] };
  const reserved = previous.reserved.map((m) => ({ ...m }));
  const reservedBranches = new Set(reserved.map((m) => m.branch));
  const released: BranchMark[] = [];
  for (const mark of previous.released) {
    if (reservedBranches.has(mark.branch)) continue;
    const confirmedAt = mark.confirmedAt ?? (previous.state === "confirmed" ? previous.confirmedAt?.toISOString() : undefined);
    if (!confirmedAt) continue; // nota automática: liberação sem confirmação não passa adiante
    if (now.getTime() >= releaseExpiry(previous, { ...mark, confirmedAt })) continue;
    released.push({ ...mark, confirmedAt });
  }
  return { released, reserved };
}

// ---------- Estados

/** `draft` → `auto_unreviewed` depois de 2 h sem resposta. Os outros estados não mudam pelo tempo. */
export function noteStateAt(note: { state: DailyNoteState; createdAt: Date }, now: Date): DailyNoteState {
  if (note.state !== "draft") return note.state;
  return now.getTime() - note.createdAt.getTime() >= NOTE_RULES.confirmHours * HOUR ? "auto_unreviewed" : "draft";
}

/** Só a dona da nota confirma; rascunho e nota automática podem ser confirmados, a confirmada fica como está. */
export function canConfirmNote(note: { personId: string; state: DailyNoteState }, byPersonId: string): boolean {
  return note.personId === byPersonId && note.state !== "confirmed";
}
