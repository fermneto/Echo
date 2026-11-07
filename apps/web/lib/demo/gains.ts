import { BUDGET, DAY_RUNS, totalCost } from "./runs";

/**
 * Ganhos dos últimos 30 dias (docs/produto.md → "Ganhos"), SINTÉTICOS até o painel ler o banco.
 * Só totais da empresa: nenhuma métrica aparece por pessoa. Cada número sai por regra dos
 * registros abaixo; a tela só formata.
 */

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Registros brutos do período (o que `questions`, `pull_requests` e `agent_runs` guardariam). */
export const PERIOD = {
  days: 30,
  /** Horas entre a resposta do agente e a volta prevista do dono, gravadas no momento. */
  waitAvoidedHours: [9, 11, 7.5, 13, 6, 10, 12, 8, 14, 5.5, 9.5, 11, 7, 10, 12.5, 8, 6.5, 9, 13.5, 10, 7, 11.5, 8.5, 9, 12, 6, 10.5, 14, 7.5, 9],
  resolved: { yes: 24, no: 3 },
  /** Horas até a primeira revisão humana: 90 dias antes do Echo e agora. */
  firstReviewHours: { before: [26, 31, 18, 40, 22, 35, 29, 19, 44, 27, 24, 33], after: [9, 14, 6, 11, 17, 8, 12, 10, 7, 15, 9, 13] },
  roundsPerPr: { before: [3, 4, 2, 5, 3, 3, 4, 2, 3, 4, 3, 5], after: [2, 2, 1, 3, 2, 2, 1, 2, 3, 2, 2, 1] },
  /** Minutos da abertura do PR até a análise automática. */
  firstAnalysisMinutes: [42, 380, 25, 310, 55, 290, 18, 340, 61, 275, 33, 300],
  fixes: { prepared: 9, approved: 6 },
  absences: { tasksMoved: 7, hoursToApproval: [1.5, 4, 2.5] },
} as const;

export type Gain = { label: string; value: string; detail: string; kind: "estimativa" | "medido" };

const h = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`;
const usd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (part: number, all: number) => (all ? Math.round((part / all) * 100) : 0);

export function gains(p: typeof PERIOD = PERIOD, costUsd = BUDGET.spentBeforeTodayUsd + totalCost(DAY_RUNS)): Gain[] {
  const waited = p.waitAvoidedHours.reduce((s, v) => s + v, 0);
  const answered = p.resolved.yes + p.resolved.no;
  const reviewBefore = median(p.firstReviewHours.before);
  const reviewAfter = median(p.firstReviewHours.after);
  const roundsBefore = median(p.roundsPerPr.before);
  const roundsAfter = median(p.roundsPerPr.after);
  return [
    { label: "Espera evitada", value: h(waited), detail: `${p.waitAvoidedHours.length} respostas antes da volta prevista do dono`, kind: "estimativa" },
    { label: "Resolveram a dúvida", value: `${pct(p.resolved.yes, answered)}%`, detail: `${p.resolved.yes} de ${answered} que responderam, só quem perguntou`, kind: "medido" },
    { label: "Primeira revisão humana", value: h(reviewAfter), detail: `mediana; era ${h(reviewBefore)} nos 90 dias antes do Echo`, kind: "medido" },
    { label: "Idas e voltas por PR", value: String(roundsAfter), detail: `mediana até a união; era ${roundsBefore}`, kind: "medido" },
    { label: "Primeira análise", value: h(median(p.firstAnalysisMinutes) / 60), detail: "mediana da abertura do PR até a análise automática", kind: "medido" },
    { label: "Correções aproveitadas", value: `${pct(p.fixes.approved, p.fixes.prepared)}%`, detail: `${p.fixes.approved} aprovadas de ${p.fixes.prepared} preparadas`, kind: "medido" },
    { label: "Cobertura em ausências", value: String(p.absences.tasksMoved), detail: `tarefas redistribuídas; aprovação em ${h(median(p.absences.hoursToApproval))} (mediana)`, kind: "medido" },
    { label: "Custo", value: usd(costUsd), detail: `${usd(waited ? costUsd / waited : 0)} por hora de espera evitada`, kind: "medido" },
  ];
}

/** Antes e depois, para o gráfico de barras da revisão. */
export function beforeAfter(p: typeof PERIOD = PERIOD) {
  return [
    { label: "Primeira revisão humana", unit: "h", before: median(p.firstReviewHours.before), after: median(p.firstReviewHours.after) },
    { label: "Idas e voltas por PR", unit: "", before: median(p.roundsPerPr.before), after: median(p.roundsPerPr.after) },
  ];
}
