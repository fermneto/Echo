// Relatório semanal (etapa 12, F7). Puras: recebem `now`, sem relógio, rede nem modelo.
// Semana ISO no fuso da pessoa, corte no fim do último expediente da semana, período coberto encadeado,
// prazos de aviso e envio, observação literal e quem confirma uma ajuda.
import { addDays, DAY, localDate, weekdayOf, zonedTime } from "./time.ts";
import type { WeeklyMetrics } from "./rules.ts";
import type { Person } from "./types.ts";

export const REPORT_RULES = {
  /** Envio automático ao RH depois do aviso. */
  sendAfterNoticeDays: 3,
  /** Sem aviso entregue até aqui (contado do corte), segue como `sent_without_notice`. */
  noNoticeDays: 7,
  observationMaxChars: 1000,
  observationsMax: 10,
  /** Reações que confirmam ajuda no Slack (a captura fica em packages/connectors). */
  helpReactions: ["pray", "raised_hands", "obrigado", "ajudou"],
} as const;

export type ReportState = "draft" | "awaiting_owner" | "commented" | "sent" | "sent_without_notice";
export interface ReportObservation {
  text: string;
  at: string;
}

const WEEK = /^(\d{4})-W(\d{2})$/;

/** Semana ISO (AAAA-Www) de uma data AAAA-MM-DD. */
export function isoWeek(date: string): string {
  const wd = weekdayOf(date) || 7; // segunda = 1 … domingo = 7
  const thursday = addDays(date, 4 - wd);
  const year = Number(thursday.slice(0, 4));
  const jan1 = Date.UTC(year, 0, 1);
  const [y, m, d] = thursday.split("-").map(Number) as [number, number, number];
  const week = Math.floor((Date.UTC(y, m - 1, d) - jan1) / DAY / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Segunda-feira (AAAA-MM-DD) da semana ISO. Null se o texto não for uma semana. */
export function weekMonday(week: string): string | null {
  const m = WEEK.exec(week);
  if (!m) return null;
  const year = Number(m[1]);
  const n = Number(m[2]);
  const jan4 = `${year}-01-04`;
  const monday = addDays(addDays(jan4, 1 - (weekdayOf(jan4) || 7)), (n - 1) * 7);
  return n >= 1 && n <= 53 && isoWeek(monday) === week ? monday : null;
}

/** Corte da semana: fim do último dia de expediente da semana, no fuso da pessoa. Null sem dia de expediente. */
export function weekCutoff(person: Pick<Person, "timezone" | "workHours">, week: string): Date | null {
  const monday = weekMonday(week);
  if (!monday) return null;
  for (let i = 6; i >= 0; i--) {
    const day = addDays(monday, i);
    if (person.workHours.days.includes(weekdayOf(day))) return zonedTime(day, person.workHours.end, person.timezone);
  }
  return null;
}

/**
 * Relatórios que já podem ser criados: a semana atual (no fuso da pessoa) depois do corte, e a anterior, para
 * quando a agenda ficou parada. A chave pessoa + semana evita duplicar. RH e inativos não têm relatório.
 */
export function reportsDue(person: Person, now: Date): { week: string; cutoff: Date }[] {
  if (!person.active || person.role === "hr") return [];
  const today = localDate(now, person.timezone);
  return [isoWeek(addDays(today, -7)), isoWeek(today)].flatMap((week) => {
    const cutoff = weekCutoff(person, week);
    return cutoff && cutoff.getTime() <= now.getTime() ? [{ week, cutoff }] : [];
  });
}

/** Cada relatório vai de onde o anterior parou; o primeiro cobre os 7 dias antes do corte. */
export function coveredPeriod(previousTo: Date | undefined, cutoff: Date): { from: Date; to: Date } | null {
  const from = previousTo ?? new Date(cutoff.getTime() - 7 * DAY);
  return from.getTime() < cutoff.getTime() ? { from, to: cutoff } : null;
}

/** O que a agenda faz agora com o relatório. */
export function reportStep(r: { state: ReportState; cutoff: Date; noticeAt?: Date | undefined }, now: Date): "send" | "send_without_notice" | "wait" {
  if (r.state === "sent" || r.state === "sent_without_notice") return "wait";
  if (r.noticeAt) return now.getTime() >= r.noticeAt.getTime() + REPORT_RULES.sendAfterNoticeDays * DAY ? "send" : "wait";
  return now.getTime() >= r.cutoff.getTime() + REPORT_RULES.noNoticeDays * DAY ? "send_without_notice" : "wait";
}

/**
 * Observação da pessoa: entra literal (só aparada e limitada), marcada como "informado pela pessoa", e nunca muda
 * os números. Null se vazia ou se o relatório já seguiu.
 */
export function observationEntry(text: string, at: Date, state: ReportState, count: number): ReportObservation | null {
  const t = text.trim();
  if (!t || state === "sent" || state === "sent_without_notice" || count >= REPORT_RULES.observationsMax) return null;
  return { text: t.slice(0, REPORT_RULES.observationMaxChars), at: at.toISOString() };
}

/** Quem vê o relatório: a própria pessoa sempre; o RH, só depois do envio. Liderança e colegas, não. */
export function canViewReport(by: Person, r: { personId: string; state: ReportState }): boolean {
  if (!by.active) return false;
  if (by.id === r.personId) return true;
  return by.role === "hr" && (r.state === "sent" || r.state === "sent_without_notice");
}

/** Ajuda confirmada no painel: quem foi ajudado confirma, nunca a própria pessoa nem o RH. */
export function canConfirmHelp(by: Person, helper: Person): boolean {
  return by.active && helper.active && by.id !== helper.id && by.role !== "hr" && helper.role !== "hr" && by.orgId === helper.orgId;
}

/** Números que o texto pode citar: só os das métricas e os dos identificadores das entregas e atrasos. */
export function reportAllowedNumbers(m: WeeklyMetrics): Set<string> {
  const out = new Set<string>([m.deliveries, m.commits, m.reviews, m.helps, m.delays.length].map(String));
  for (const h of m.helped) out.add(String(h.count));
  return out;
}
