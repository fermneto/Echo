import type { AuditEntry } from "@/app/(painel)/execucoes/RunsBoard";
import { flowLabel, type Run, type RunResult, totalCost } from "./demo/runs";

/**
 * De linhas do banco (`agent_runs`, `audit_log`) para o que a tela "Custo e execuções" mostra. Regra pura,
 * testada em runs-db.test.ts: o custo vem de cost_usd quando a execução gravou, e da tabela de preços quando não.
 */

export type RunRowIn = {
  id: string;
  flow: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: string | null;
  durationMs: number;
  tools: string[] | null;
  result: string;
  error: string | null;
  createdAt: Date;
};

export type AuditRowIn = { id: string; actor: string; action: string; target: string; createdAt: Date };

const RESULTS: readonly RunResult[] = ["ok", "fallback", "refused", "failed", "skipped"];

/** "07/11 14:02" no fuso da empresa. */
export function shortAt(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

const clip = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describe(label: string, result: RunResult, error: string | null): string {
  const why = error ? `: ${clip(error)}` : "";
  switch (result) {
    case "ok":
      return `${label} concluída`;
    case "fallback":
      return `${label} por regra, sem modelo${why}`;
    case "refused":
      return `${label} recusada pelo validador${why}`;
    case "failed":
      return `${label} falhou${why}`;
    case "skipped":
      return `${label} pulada${why}`;
  }
}

export function runFromRow(r: RunRowIn, timeZone: string): Run {
  const result: RunResult = (RESULTS as readonly string[]).includes(r.result) ? (r.result as RunResult) : r.error ? "failed" : "ok";
  const cost = r.costUsd === null ? undefined : Number(r.costUsd);
  return {
    id: r.id,
    at: shortAt(r.createdAt, timeZone),
    flow: r.flow,
    model: r.model,
    inputTokens: r.inputTokens ?? 0,
    outputTokens: r.outputTokens ?? 0,
    ...(cost !== undefined && Number.isFinite(cost) ? { costUsd: cost } : {}),
    durationMs: r.durationMs,
    tools: Array.isArray(r.tools) ? r.tools : [],
    result,
    what: describe(flowLabel(r.flow), result, r.error),
  };
}

const ACTIONS: Record<string, string> = {
  "demo.reset": "recriou a demonstração",
  "login:slack": "entrou no painel pelo Slack",
  "absence:confirmar_agenda": "confirmou a ausência da agenda",
  "rh:ausencia_registrada": "registrou uma ausência",
  "rh:matricula_desconhecida": "recebeu matrícula desconhecida",
};
const PREFIXED: Record<string, string> = { approve: "aprovou", execute: "executou" };

export function actionLabel(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action];
  const [head, ...rest] = action.split(":");
  const verb = head ? PREFIXED[head] : undefined;
  return verb && rest.length ? `${verb} ${rest.join(":")}` : action;
}

/** "person:<id>" vira o nome; "org:<id>" vira "a empresa"; o resto fica como está. */
export function refLabel(ref: string, names: Record<string, string>): string {
  if (ref === "seed") return "Seed";
  if (ref === "rh") return "RH";
  if (ref.startsWith("echo:")) return "Echo";
  const [kind, id] = ref.split(/:(.*)/s);
  if (kind === "person" && id) return names[id] ?? "pessoa removida";
  if (kind === "org") return "a empresa";
  if (kind === "absence") return "ausência";
  return ref;
}

export function auditFromRow(a: AuditRowIn, names: Record<string, string>, timeZone: string): AuditEntry {
  return { id: a.id, at: shortAt(a.createdAt, timeZone), actor: refLabel(a.actor, names), action: actionLabel(a.action), target: refLabel(a.target, names) };
}

/** Primeiro dia do mês, em UTC: o mesmo corte que os fluxos usam para o limite de custo. */
export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/**
 * O que a tela precisa: execuções e auditoria mapeadas e o ajuste do gasto do mês. A tela soma o custo das
 * execuções listadas por cima de `spentBeforeUsd` (como faz com a noite simulada); por isso ele é o gasto do mês
 * menos o que já está na lista, e o total mostrado volta a ser o gasto real do mês.
 */
export function runsBoardFromDb(
  view: { runs: RunRowIn[]; audit: AuditRowIn[]; monthSpentUsd: number; names: Record<string, string> },
  opts: { timeZone: string },
): { runs: Run[]; audit: AuditEntry[]; spentBeforeUsd: number } {
  const runs = view.runs.map((r) => runFromRow(r, opts.timeZone));
  return {
    runs,
    audit: view.audit.map((a) => auditFromRow(a, view.names, opts.timeZone)),
    spentBeforeUsd: view.monthSpentUsd - totalCost(runs),
  };
}
