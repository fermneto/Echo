// Contratos dos agentes (aba IA). Frente: Funções implementa o laço; frente Avaliador testa contra estes tipos.
import { z } from "zod";

export const MODELS = {
  answer: "claude-sonnet-5-5",
  dailyNote: "claude-haiku-5-5",
  review: "claude-sonnet-5-5",
  reviewSensitive: "claude-opus-5-5",
  report: "claude-sonnet-5-5",
  artifact: "claude-haiku-5-5",
} as const;

export const LIMITS = { maxRounds: 4, timeoutMs: 30_000, presenceTimeoutMs: 1_500 } as const;

/** Ferramentas somente leitura do agente. */
export const TOOL_NAMES = [
  "get_daily_note",
  "search_brain",
  "get_branch_status",
  "get_pr",
  "get_task",
  "list_team",
  "list_tasks",
  "list_pull_requests",
  "list_recent_events",
  "find_people_by_topic",
  // só liderança
  "get_team_workload",
  "list_capacity_cards",
  "get_open_work",
  "get_task_context",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Saída estruturada do modelo na resposta a um colega (F2). */
export const answerOutputSchema = z.object({
  status: z.enum(["respondido", "nao_sei", "recusado"]),
  texto: z.string(),
  fontes: z.array(z.string()), // ids de fontes consultadas NESTA execução
  liberacao: z.object({ alvo: z.string(), tipo: z.enum(["branch", "tarefa", "pr"]) }).nullable(),
  precisa_do_dono: z.boolean(),
});
export type AnswerOutput = z.infer<typeof answerOutputSchema>;

/** Pergunta que entra no fluxo de resposta (Slack, painel, simulador ou MCP — mesmo fluxo). */
export interface AnswerRequest {
  orgId: string;
  askerId: string;
  ownerId?: string; // dono do gêmeo; ausente = agente da equipe (F2b)
  text: string;
  channel: "slack" | "painel" | "simulador" | "mcp";
  thread?: { author: string; text: string }[]; // até 8 mensagens, como dado
}

/** Resposta final, já com cabeçalho, hora de volta, fontes e avisos adicionados pelo código. */
export interface AnswerResult {
  agentName: string; // "Agente de Fernando" | "Echo"
  text: string;
  sources: { label: string; ref: string }[];
  needsOwner: boolean;
  ownerReturnsAt?: Date;
  usedModel: boolean; // false = resposta por regra (teto de custo ou API fora)
  warnings: string[]; // ex.: "nota do dia não confirmada"
}

export interface ValidationIssue {
  code: "fonte_inexistente" | "liberacao_falsa" | "assunto_proibido" | "primeira_pessoa" | "numero_inventado";
  detail: string;
}

/** Validador em código (etapa 6). Recusa a resposta se houver qualquer issue. */
export type AnswerValidator = (out: AnswerOutput, ctx: { ownerName?: string; sourcesThisRun: string[]; releasedTargets: string[] }) => ValidationIssue[];
export { validateAnswer } from "./validator.ts";
