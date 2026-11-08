import type { PersonSchedule } from "@echo/domain";
import type { AwayRow } from "./away-log";
import type { PlanItem } from "./demo/plan";

/** Mini Echo: a janelinha flutuante com as tarefas atuais e as mensagens novas do agente da pessoa. Regras puras. */

export const MINI_MAX_TASKS = 8;

export type MiniTask = {
  key: string;
  /** Chave no tracker (ECH-128), quando a tarefa veio da agenda. */
  ref: string | null;
  title: string;
  late: boolean;
};

export type MiniMessage = {
  key: string;
  /** "HH:MM" no fuso da pessoa. */
  time: string;
  text: string;
  /** Ficou algo para a pessoa decidir. */
  waiting: boolean;
};

export type MiniData = {
  /** "Agente de Fernando": o agente sempre se identifica. */
  agent: string;
  tasks: MiniTask[];
  messages: MiniMessage[];
};

/** Tarefas do primeiro dia da agenda: hoje ou, em folga e fim de semana, o próximo dia de trabalho. */
export function tasksFromSchedule(schedule: PersonSchedule): MiniTask[] {
  return (schedule.days[0]?.entries ?? []).slice(0, MINI_MAX_TASKS).map((e) => ({ key: e.key, ref: e.key, title: e.title, late: e.late }));
}

/** Demonstração sem banco: os itens do plano da história. */
export function tasksFromPlan(items: readonly PlanItem[]): MiniTask[] {
  return items.slice(0, MINI_MAX_TASKS).map((it) => ({ key: it.id, ref: null, title: it.title, late: false }));
}

export function messagesFromRows(rows: readonly AwayRow[]): MiniMessage[] {
  return rows.map((r) => ({ key: r.key, time: r.time, text: r.text, waiting: r.tone === "wait" }));
}

/** Quantas mensagens a pessoa ainda não abriu neste navegador. */
export function unseenCount(messages: readonly Pick<MiniMessage, "key">[], seen: ReadonlySet<string>): number {
  return messages.filter((m) => !seen.has(m.key)).length;
}

/** Lista guardada no navegador. Valor corrompido vale como nada visto, nunca como erro. */
export function parseSeen(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const list: unknown = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}
