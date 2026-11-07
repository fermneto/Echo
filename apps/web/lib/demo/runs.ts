import { costLevel, type CostLevel } from "@echo/domain";

/**
 * Execuções (`agent_runs`) da demo, SINTÉTICAS até o painel ler o banco. O custo de cada linha sai
 * por regra dos tokens e da tabela de preços (docs/engenharia.md → "Estimativas de custo por fluxo"):
 * nenhum número desta tela é escrito à mão nem pelo modelo.
 */

export type Model = "claude-sonnet-5-5" | "claude-haiku-5-5";
export type RunResult = "ok" | "fallback" | "refused" | "failed" | "skipped";
export type Run = {
  id: string;
  at: string;
  /** Fluxo conhecido (FLOWS) ou outro nome gravado pelo worker; flowLabel() dá o rótulo. */
  flow: Flow | (string & {});
  /** Sem modelo quando a resposta saiu só por regra. */
  model: Model | (string & {}) | null;
  inputTokens: number;
  outputTokens: number;
  /** API de lotes: metade do preço. */
  batch?: boolean;
  /** Custo gravado na execução (agent_runs.cost_usd); quando existe, vale ele em vez da tabela de preços. */
  costUsd?: number;
  durationMs: number;
  tools: string[];
  result: RunResult;
  what: string;
};

export const FLOWS = {
  answer: "Respostas",
  who_knows: "Quem sabe",
  daily_note: "Nota do dia",
  morning_plan: "Plano da manhã",
  pr_review: "Revisão de PR",
  fix: "Correção",
  redistribution: "Redistribuição",
  weekly_report: "Relatório semanal",
  away_digest: "Resumo da ausência",
} as const;
export type Flow = keyof typeof FLOWS;

/** Nomes que o worker grava além dos fluxos principais. */
const EXTRA_FLOWS: Record<string, string> = {
  quem_sabe: "Quem sabe",
  daily_note_confirm: "Nota do dia",
  daily_note_timeout: "Nota do dia",
  fix_applied: "Correção",
  fix_decision: "Correção",
  fix_ready: "Correção",
  night_review: "Revisão de PR",
  night_review_batch: "Revisão de PR",
  gains_baseline: "Ganhos",
  help_confirm: "Ajuda",
  redistribution_done: "Redistribuição",
  weekly_report_comment: "Relatório semanal",
  weekly_report_sent: "Relatório semanal",
};

/** Rótulo do fluxo; nome desconhecido vira texto legível ("novo_fluxo" → "Novo fluxo"). */
export function flowLabel(flow: string): string {
  const known = (FLOWS as Record<string, string>)[flow] ?? EXTRA_FLOWS[flow];
  if (known) return known;
  const text = flow.replace(/[_.:-]+/g, " ").trim();
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Outro";
}

/** US$ por milhão de tokens (entrada, saída). */
export const PRICES: Record<Model, { input: number; output: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export const MODEL_LABEL: Record<Model, string> = {
  "claude-sonnet-5-5": "Sonnet 5.5",
  "claude-haiku-5-5": "Haiku 5.5",
};

export const modelLabel = (m: string) => (MODEL_LABEL as Record<string, string>)[m] ?? m;

export function runCost(r: Pick<Run, "model" | "inputTokens" | "outputTokens" | "batch" | "costUsd">): number {
  if (r.costUsd !== undefined) return r.costUsd;
  if (!r.model) return 0;
  const p = (PRICES as Record<string, { input: number; output: number }>)[r.model];
  if (!p) return 0;
  const usd = (r.inputTokens * p.input + r.outputTokens * p.output) / 1_000_000;
  return r.batch ? usd / 2 : usd;
}

export type FlowTotal = { label: string; runs: number; costUsd: number; byRule: number };

/** Custo e número de execuções por fluxo, do mais caro ao mais barato. */
export function totalsByFlow(runs: readonly Run[]): FlowTotal[] {
  // Agrupa pelo rótulo: night_review e pr_review somam juntos em "Revisão de PR".
  const map = new Map<string, FlowTotal>();
  for (const r of runs) {
    const label = flowLabel(r.flow);
    const t = map.get(label) ?? { label, runs: 0, costUsd: 0, byRule: 0 };
    t.runs += 1;
    t.costUsd += runCost(r);
    if (!r.model) t.byRule += 1;
    map.set(label, t);
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd || a.label.localeCompare(b.label));
}

export const totalCost = (runs: readonly Run[]) => runs.reduce((s, r) => s + runCost(r), 0);

/** Limite mensal configurado pela empresa e o que já foi gasto antes de hoje (sintético). */
export const BUDGET = { monthlyLimitUsd: 60, spentBeforeTodayUsd: 11.84 };

/** `spentBeforeUsd`: o gasto do mês que não está nas execuções da tela (no banco, o resto do mês). */
export function budgetStatus(
  todayUsd: number,
  spentBeforeUsd: number = BUDGET.spentBeforeTodayUsd,
  limitUsd: number = BUDGET.monthlyLimitUsd,
): { spentUsd: number; ratio: number; level: CostLevel } {
  const spentUsd = spentBeforeUsd + todayUsd;
  return { spentUsd, ratio: limitUsd > 0 ? spentUsd / limitUsd : 0, level: costLevel(spentUsd, limitUsd) };
}

export const LEVEL_LABEL: Record<CostLevel, string> = {
  normal: "Normal: todos os fluxos ligados",
  stop_fixes: "80% do limite: correções e vídeos param",
  rules_only: "Limite atingido: só respostas por regra",
  hard_limit: "Dobro do limite: ausentes respondem sem IA",
};

export const formatUsd = (v: number) => `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: v > 0 && v < 0.01 ? 4 : 2 })}`;

/** O dia 06/11 da demo, do mais recente ao mais antigo. */
export const DAY_RUNS: readonly Run[] = [
  { id: "run-118", at: "06/11 14:02", flow: "answer", model: "claude-sonnet-5-5", inputTokens: 7400, outputTokens: 420, durationMs: 6100, tools: ["daily_note", "github.branch"], result: "ok", what: "Eduardo perguntou ao agente de Fernando sobre a ech-131-api-v2" },
  { id: "run-117", at: "06/11 14:01", flow: "answer", model: null, inputTokens: 0, outputTokens: 0, durationMs: 140, tools: ["daily_note"], result: "fallback", what: "ech-128-tempo-limite está reservada: resposta por regra" },
  { id: "run-116", at: "06/11 13:40", flow: "answer", model: null, inputTokens: 0, outputTokens: 0, durationMs: 90, tools: [], result: "refused", what: "Pedido para aprovar PR recusado pelo validador" },
  { id: "run-115", at: "06/11 11:20", flow: "who_knows", model: null, inputTokens: 0, outputTokens: 0, durationMs: 210, tools: ["topic_evidence"], result: "ok", what: "Quem sabe de pagamentos: evidência do GitHub e das notas" },
  { id: "run-114", at: "06/11 09:05", flow: "morning_plan", model: "claude-haiku-5-5", inputTokens: 9800, outputTokens: 960, durationMs: 4200, tools: ["github.prs", "linear.issues", "questions"], result: "ok", what: "Plano da manhã de Fernando" },
  { id: "run-113", at: "06/11 03:12", flow: "fix", model: "claude-sonnet-5-5", inputTokens: 186000, outputTokens: 9400, durationMs: 412000, tools: ["sandbox", "tests"], result: "ok", what: "Correção do PR 41 preparada em ambiente isolado" },
  { id: "run-112", at: "06/11 02:30", flow: "pr_review", model: "claude-sonnet-5-5", inputTokens: 96000, outputTokens: 4800, batch: true, durationMs: 1260000, tools: ["github.diff"], result: "ok", what: "Revisão noturna do PR 41, em lote" },
  { id: "run-111", at: "06/11 02:30", flow: "pr_review", model: "claude-sonnet-5-5", inputTokens: 41000, outputTokens: 2600, batch: true, durationMs: 1260000, tools: ["github.diff"], result: "ok", what: "Revisão noturna do PR 37, em lote" },
  { id: "run-110", at: "05/11 18:10", flow: "daily_note", model: "claude-haiku-5-5", inputTokens: 5200, outputTokens: 480, durationMs: 2900, tools: ["github.commits", "linear.issues"], result: "ok", what: "Rascunho da nota do dia de Fernando" },
  { id: "run-109", at: "05/11 17:05", flow: "daily_note", model: "claude-haiku-5-5", inputTokens: 4700, outputTokens: 510, durationMs: 2600, tools: ["github.commits", "linear.issues"], result: "ok", what: "Rascunho da nota do dia de Eduardo" },
  { id: "run-108", at: "05/11 16:00", flow: "redistribution", model: null, inputTokens: 0, outputTokens: 0, durationMs: 320, tools: ["capacity", "areas"], result: "ok", what: "Plano para as férias de Bruno, por regra" },
  { id: "run-107", at: "05/11 15:30", flow: "weekly_report", model: "claude-haiku-5-5", inputTokens: 6100, outputTokens: 1900, durationMs: 3800, tools: ["weekly_metrics", "contributions"], result: "ok", what: "Relatório semanal de Carla" },
  { id: "run-106", at: "05/11 08:00", flow: "away_digest", model: null, inputTokens: 0, outputTokens: 0, durationMs: 180, tools: ["questions"], result: "ok", what: "Resumo do que chegou enquanto Fernando dormia" },
];

/** O que "Simular a noite" acrescenta: a mesma análise que o lote faria de madrugada. */
export const NIGHT_RUNS: readonly Run[] = [
  { id: "run-120", at: "agora", flow: "pr_review", model: "claude-sonnet-5-5", inputTokens: 88000, outputTokens: 4300, batch: true, durationMs: 38000, tools: ["github.diff"], result: "ok", what: "Revisão simulada do PR 41 (noite comprimida)" },
  { id: "run-119", at: "agora", flow: "morning_plan", model: "claude-haiku-5-5", inputTokens: 9100, outputTokens: 900, durationMs: 3900, tools: ["github.prs", "linear.issues", "questions"], result: "ok", what: "Plano da manhã refeito com a análise da noite" },
];

export const RESULT_LABEL: Record<RunResult, string> = { ok: "ok", fallback: "por regra", refused: "recusada", failed: "falhou", skipped: "pulada" };
