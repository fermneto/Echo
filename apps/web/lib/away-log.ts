import type { AwayLog } from "@echo/agents/enquanto-fora";
import { addDays, localDate, weekdayOf, zonedTime, type WorkHours } from "@echo/domain";
import type { NightEntry } from "./demo/feed";
import { localTime } from "./time";

/**
 * "Enquanto você estava fora", no Início: o que o agente da própria pessoa fez desde o fim do expediente.
 * Regras de exibição puras; a leitura do banco fica em away-live.ts.
 */

export const AWAY_MAX = 5;

export type AwayRow = {
  key: string;
  /** "HH:MM" no fuso da pessoa. */
  time: string;
  text: string;
  /** Fonte ou referência citada (nota do dia, PR, tarefa). */
  ref?: string;
  /** "wait" quando ficou algo para a pessoa decidir. */
  tone: "ok" | "wait";
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** A resposta começa com "Agente de Fulano:"; na lista, o título da seção já diz de quem é o agente. */
const withoutSigner = (s: string) => s.replace(/^Agente de [^:]+:\s*/u, "");

/**
 * Fim do último expediente antes de `now`, no fuso da pessoa. Se ela está no expediente, é o fim do anterior.
 * Sem expediente nos últimos 7 dias, as últimas 24 horas.
 */
export function lastWorkEnd(p: { timezone: string; workHours: WorkHours }, now: Date): Date {
  const today = localDate(now, p.timezone);
  for (let back = 0; back <= 7; back++) {
    const date = addDays(today, -back);
    if (!p.workHours.days.includes(weekdayOf(date))) continue;
    const end = zonedTime(date, p.workHours.end, p.timezone);
    const start = zonedTime(date, p.workHours.start, p.timezone);
    // Hoje, ainda no expediente: vale o fim do dia de trabalho anterior.
    if (end.getTime() <= now.getTime() && start.getTime() < end.getTime()) return end;
  }
  return new Date(now.getTime() - 24 * 3_600_000);
}

/** Demonstração: o registro da noite (feed.ts) só da pessoa, do mais recente ao mais antigo. */
export function demoAwayRows(personId: string, timezone: string, log: readonly NightEntry[]): AwayRow[] {
  return log
    .filter((e) => e.personId === personId)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((e, i) => ({
      key: `${e.at}:${i}`,
      time: localTime(new Date(e.at), timezone),
      text: cap(e.text),
      ...(e.ref ? { ref: e.ref } : {}),
      tone: /não liberou|plano da manhã|aprovação/u.test(e.text) ? "wait" : "ok",
    }));
}

/** Banco: perguntas respondidas, correções prontas e o plano da manhã enviado, numa lista só. */
export function awayRows(log: AwayLog, timezone: string): AwayRow[] {
  const rows: (AwayRow & { at: number })[] = [];
  for (const q of log.questions) {
    const who = q.askerName ?? "alguém";
    const outcome = q.needsOwner ? "Ficou para você decidir." : "Respondida com o que estava registrado.";
    const answer = q.answer ? withoutSigner(q.answer).replace(/[.\s]+$/u, "") : "";
    const text = q.text
      ? `${cap(who)} perguntou: “${clip(q.text, 80)}”. ${outcome}`
      : answer
        ? `Respondeu a ${who}: ${clip(answer)}.${q.needsOwner ? ` ${outcome}` : ""}`
        : `${cap(who)} perguntou. ${outcome}`;
    const src = q.sources[0]?.label;
    rows.push({
      key: `q:${q.id}`,
      at: q.at.getTime(),
      time: localTime(q.at, timezone),
      text,
      ...(src ? { ref: src } : {}),
      tone: q.needsOwner ? "wait" : "ok",
    });
  }
  for (const f of log.fixes) {
    const done = f.state === "ready" ? "pronta para sua aprovação" : f.state === "approved" ? "aprovada" : "aplicada";
    rows.push({ key: `f:${f.id}`, at: f.at.getTime(), time: localTime(f.at, timezone), text: `Preparou uma correção no PR ${f.prNumber}, ${clip(f.prTitle, 60)}: ${done}.`, ref: `PR ${f.prNumber}`, tone: f.state === "ready" ? "wait" : "ok" });
  }
  if (log.plan && log.plan.items > 0) {
    const n = log.plan.items;
    rows.push({ key: `p:${log.plan.date}`, at: log.plan.at.getTime(), time: localTime(log.plan.at, timezone), text: `Montou seu plano da manhã com ${n} ${n === 1 ? "item" : "itens"}.`, ref: "plano da manhã", tone: "ok" });
  }
  return rows.sort((a, b) => b.at - a.at).map(({ at: _at, ...r }) => r);
}
