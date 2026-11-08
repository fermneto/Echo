// Agenda da pessoa: em que dia cada tarefa dela entra, por regra. Pura: recebe `now`, sem relógio, rede nem modelo.
// Prazo, dependências e carga decidem a sugestão; a pessoa muda o dia de qualquer tarefa, e nada disso vai ao tracker.
import { RULES } from "./rules.ts";
import { addDays, coveredMs, localDate, weekdayOf, zonedTime } from "./time.ts";
import type { Absence, Person, Task } from "./types.ts";

export const SCHEDULE_RULES = {
  /** Dias de trabalho que a agenda alcança. */
  horizonWorkdays: 5,
  /** Pontos de tarefa por dia de trabalho. */
  pointsPerDay: 3,
  /** Até quantos dias corridos procurar os dias de trabalho (férias longas). */
  searchDays: 45,
} as const;

/** Como a tarefa aparece no dia: cabe inteira, começa, segue ou termina ali. */
export type SchedulePart = "inteira" | "inicia" | "continua" | "conclui";

export interface ScheduleEntry {
  key: string;
  title: string;
  part: SchedulePart;
  points: number;
  dueDate?: string | undefined;
  /** Motivo, escrito por regra. */
  reason: string;
  /** Não termina até o prazo. */
  late: boolean;
  /** A própria pessoa escolheu o dia. */
  pinned: boolean;
}

export interface ScheduleDay {
  date: string;
  points: number;
  entries: ScheduleEntry[];
}

export interface WaitingTask {
  key: string;
  title: string;
  /** O que falta entregar antes, com quem está. */
  waitingOn: { key: string; owner?: string | undefined }[];
  /** A própria pessoa tinha escolhido um dia: pode voltar à sugestão. */
  pinned: boolean;
}

export interface PersonSchedule {
  days: ScheduleDay[];
  /** Tarefas paradas por entrega sem previsão. */
  waiting: WaitingTask[];
  /** Não couberam no horizonte. */
  later: { key: string; title: string }[];
}

export interface ScheduleInput {
  person: Person;
  people: Person[];
  /** Tarefas abertas da empresa: as dependências podem estar com outras pessoas. */
  tasks: Task[];
  absences: Absence[];
  now: Date;
  /** Tarefa → dia escolhido pela própria pessoa. */
  pins?: Readonly<Record<string, string>>;
}

const OPEN: ReadonlySet<Task["state"]> = new Set(["backlog", "todo", "in_progress", "in_review"]);
/** Em revisão o trabalho da pessoa já foi entregue: não ocupa a agenda. */
const WORKABLE: ReadonlySet<Task["state"]> = new Set(["backlog", "todo", "in_progress"]);
const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** Pontos da tarefa; sem tamanho, o valor fixo das regras. */
export const taskPoints = (t: Pick<Task, "size">) => t.size || RULES.unsizedTaskPoints;

/** "Hoje", "Amanhã" ou o dia da semana. */
export function scheduleDayLabel(date: string, today: string): string {
  if (date === today) return "Hoje";
  if (date === addDays(today, 1)) return "Amanhã";
  return WEEKDAY[weekdayOf(date)]!;
}

/** Próximos dias de trabalho da pessoa, a partir de hoje, sem os dias tomados por ausência. */
export function workdays(person: Person, absences: Absence[], now: Date, count: number = SCHEDULE_RULES.horizonWorkdays): string[] {
  const mine = absences.filter((a) => a.personId === person.id).map((a) => ({ start: a.startsAt, end: a.endsAt }));
  const today = localDate(now, person.timezone);
  const out: string[] = [];
  for (let i = 0; i < SCHEDULE_RULES.searchDays && out.length < count; i++) {
    const date = addDays(today, i);
    if (!person.workHours.days.includes(weekdayOf(date))) continue;
    const start = zonedTime(date, person.workHours.start, person.timezone);
    const end = zonedTime(date, person.workHours.end, person.timezone);
    // Só sai o dia em que a ausência toma o expediente inteiro: um compromisso curto não tira o dia.
    if (coveredMs(mine, start, end) < end.getTime() - start.getTime()) out.push(date);
  }
  return out;
}

/**
 * Distribui as tarefas da pessoa pelos próximos dias de trabalho, até o limite de pontos de cada dia.
 * Vem primeiro o que ficou pela metade, depois o dia escolhido por ela, o que já está em andamento, o prazo mais
 * próximo e o que libera mais gente. Tarefa só entra depois do que a bloqueia: dependência dela mesma termina antes,
 * e dependência de outra pessoa conta a partir do prazo dela. Sem prazo, a tarefa fica esperando, sem dia inventado.
 */
export function personSchedule(input: ScheduleInput): PersonSchedule {
  const { person, people, now } = input;
  const today = localDate(now, person.timezone);
  const pins = input.pins ?? {};
  const open = new Map(input.tasks.filter((t) => OPEN.has(t.state)).map((t) => [t.key, t]));
  const mine = [...open.values()].filter((t) => t.assigneeId === person.id && WORKABLE.has(t.state));
  const left = new Map(mine.map((t) => [t.key, taskPoints(t)]));
  const firstName = (id: string | undefined) => people.find((p) => p.id === id)?.name.trim().split(/\s+/)[0];

  const blockersOf = (t: Task) => (t.blockedBy ?? []).flatMap((k) => (k !== t.key && open.has(k) ? [open.get(k)!] : []));
  const unblocks = (t: Task) => [...open.values()].filter((o) => o.key !== t.key && o.blockedBy?.includes(t.key));

  /** Primeiro dia possível por causa de entregas de outras pessoas. Null: sem previsão. */
  const earliest = (t: Task): string | null => {
    let day = today;
    for (const b of blockersOf(t)) {
      if (left.has(b.key)) continue;
      if (!b.dueDate || b.dueDate < today) return null;
      const after = addDays(b.dueDate, 1);
      if (after > day) day = after;
    }
    return day;
  };

  const rank = (t: Task) => [t.state === "in_progress" ? 0 : 1, t.dueDate ? Date.parse(`${t.dueDate}T00:00:00Z`) : Number.MAX_SAFE_INTEGER, -unblocks(t).length, t.state === "backlog" ? 1 : 0] as const;
  const queue = [...mine].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
    return a.key < b.key ? -1 : 1;
  });

  const placed = new Map<string, { date: string; points: number }[]>();
  // Na ordem em que entraram: é a ordem de fazer, com a dependência antes do que ela libera.
  const allocations: { key: string; date: string; points: number }[] = [];
  const pinnedNow = (key: string) => Boolean(pins[key] && pins[key]! >= today);
  const ready = (t: Task, date: string) => {
    const from = earliest(t);
    if ((left.get(t.key) ?? 0) <= 0 || from === null || date < from) return false;
    if (pins[t.key] && pins[t.key]! >= today && date < pins[t.key]!) return false;
    return blockersOf(t).every((b) => (left.get(b.key) ?? 0) <= 0);
  };

  const dates = workdays(person, input.absences, now);
  for (const date of dates) {
    let room: number = SCHEDULE_RULES.pointsPerDay;
    while (room > 0) {
      const eligible = queue.filter((t) => ready(t, date));
      const next = eligible.find((t) => placed.has(t.key)) ?? eligible.find((t) => pins[t.key] === date) ?? eligible[0];
      if (!next) break;
      const give = Math.min(room, left.get(next.key)!);
      placed.set(next.key, [...(placed.get(next.key) ?? []), { date, points: give }]);
      allocations.push({ key: next.key, date, points: give });
      left.set(next.key, left.get(next.key)! - give);
      room -= give;
    }
  }

  const finishDay = (t: Task) => ((left.get(t.key) ?? 0) > 0 ? undefined : placed.get(t.key)?.at(-1)?.date);
  const isLate = (t: Task) => Boolean(t.dueDate && (t.dueDate < today || (placed.has(t.key) && (finishDay(t) ?? "9999") > t.dueDate)));

  const reasonOf = (t: Task): string => {
    const parts: string[] = [];
    if (pins[t.key] && placed.get(t.key)?.[0]?.date === pins[t.key]) parts.push("dia escolhido por você");
    if (t.state === "in_progress") parts.push("já em andamento");
    if (isLate(t)) parts.push(`não termina até o prazo de ${ddmm(t.dueDate!)}`);
    else if (t.dueDate) parts.push(`prazo ${ddmm(t.dueDate)}`);
    for (const b of blockersOf(t)) parts.push(left.has(b.key) ? `depois da ${b.key}` : `depois da ${b.key} de ${firstName(b.assigneeId) ?? "outra pessoa"}, prazo ${ddmm(b.dueDate!)}`);
    const freed = unblocks(t).filter((o) => o.assigneeId !== person.id);
    if (freed.length) parts.push(`libera ${freed.map((o) => (firstName(o.assigneeId) ? `${o.key} de ${firstName(o.assigneeId)}` : o.key)).join(", ")}`);
    return parts.join(", ") || "sem prazo definido";
  };

  const days: ScheduleDay[] = dates.map((date) => ({ date, points: 0, entries: [] }));
  const taskOf = new Map(mine.map((t) => [t.key, t]));
  const position = new Map<string, number>();
  for (const { key, date, points } of allocations) {
    const t = taskOf.get(key)!;
    const slots = placed.get(key)!;
    const i = position.get(key) ?? 0;
    position.set(key, i + 1);
    const finished = (left.get(key) ?? 0) <= 0;
    const part: SchedulePart = slots.length === 1 ? (finished ? "inteira" : "inicia") : i === 0 ? "inicia" : i === slots.length - 1 && finished ? "conclui" : "continua";
    const day = days.find((d) => d.date === date)!;
    day.points += points;
    day.entries.push({ key, title: t.title, part, points, dueDate: t.dueDate, reason: reasonOf(t), late: isLate(t), pinned: pinnedNow(key) });
  }

  const waiting: WaitingTask[] = [];
  const later: PersonSchedule["later"] = [];
  for (const t of queue) {
    if (placed.has(t.key)) continue;
    const pending = blockersOf(t).filter((b) => (left.get(b.key) ?? 0) > 0 || !left.has(b.key));
    const stuck = earliest(t) === null || pending.some((b) => left.has(b.key));
    if (stuck) waiting.push({ key: t.key, title: t.title, waitingOn: pending.map((b) => ({ key: b.key, owner: b.assigneeId === person.id ? undefined : firstName(b.assigneeId) })), pinned: pinnedNow(t.key) });
    else later.push({ key: t.key, title: t.title });
  }
  return { days, waiting, later };
}

/** Só a própria pessoa muda o dia: precisa ser um dia de trabalho da agenda. */
export function validPin(date: string, person: Person, absences: Absence[], now: Date): boolean {
  return workdays(person, absences, now).includes(date);
}

/** Tarefas que já têm dia ou esperam outra entrega: o prazo delas aparece na agenda. */
export function scheduledKeys(schedule: PersonSchedule): Set<string> {
  return new Set([...schedule.days.flatMap((d) => d.entries.map((e) => e.key)), ...schedule.waiting.map((w) => w.key)]);
}

/** Férias, licença ou imprevisto em curso. Compromisso curto e ausência inferida da agenda não tiram a pessoa da distribuição. */
export function onLeaveNow(personId: string, absences: Absence[], now: Date): boolean {
  return absences.some((a) => a.personId === personId && a.kind !== "ooo" && !a.inferred && a.startsAt <= now && a.endsAt > now);
}

export type AssignCheck = { ok: true } | { ok: false; reason: string };

/** Liderança distribui o que não tem responsável, dentro da própria equipe; nunca a quem está de férias ou licença, nem ao RH. */
export function assignCheck(input: { leader: Person; target: Person; task: Task; absences: Absence[]; now: Date }): AssignCheck {
  const { leader, target, task, now } = input;
  if (leader.role !== "leader") return { ok: false, reason: "Só a liderança distribui tarefas." };
  if (!target.active || target.role === "hr") return { ok: false, reason: "Esta pessoa não recebe tarefas." };
  if (leader.teamId && target.teamId !== leader.teamId) return { ok: false, reason: "Esta pessoa é de outra equipe." };
  if (task.state === "done" || task.state === "canceled") return { ok: false, reason: "Esta tarefa já foi encerrada." };
  if (task.assigneeId) return { ok: false, reason: "A tarefa já tem responsável. Para trocar, use Redistribuição." };
  if (onLeaveNow(target.id, input.absences, now)) return { ok: false, reason: "Esta pessoa está ausente agora." };
  return { ok: true };
}
