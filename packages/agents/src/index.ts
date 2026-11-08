// Contratos dos agentes (aba IA). Frente: Funções implementa o laço; frente Avaliador testa contra estes tipos.
import type { DigestKind } from "@echo/domain";
import { z } from "zod";

export const MODELS = {
  answer: "claude-sonnet-5-5",
  dailyNote: "claude-haiku-5-5",
  review: "claude-sonnet-5-5",
  reviewSensitive: "claude-opus-5-5",
  /** Correção no Managed Agents, esforço médio. */
  fix: "claude-sonnet-5-5",
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
  /**
   * gemeo = agente de uma pessoa · livre = pergunta ao Echo · quem_sabe = indicação por evidência.
   * Quem sabe sem fontes numa mensagem de canal que não chamou o @Echo: quem publica fica em silêncio.
   */
  kind?: "gemeo" | "livre" | "quem_sabe";
  /**
   * Para o resumo da ausência (F5b), por regra: o tipo da mensagem e uma linha de pedido e outra de resposta.
   * Só quando há dono e ele está fora. Quem grava a pergunta guarda estes campos; as linhas somem na entrega ou em 30 dias.
   */
  digest?: { kind: DigestKind; request: string; reply: string };
  /**
   * Gasto do mês acima do dobro do limite: a resposta saiu por regra, sem modelo. Quem grava a pergunta
   * a guarda como falha em `questions` (docs/produto.md → Teto de custo), e ela não conta nos ganhos.
   */
  overLimit?: true;
}

export interface ValidationIssue {
  code: "fonte_inexistente" | "liberacao_falsa" | "assunto_proibido" | "primeira_pessoa" | "numero_inventado";
  detail: string;
}

/** O que o validador sabe da execução. */
export interface ValidatorContext {
  ownerName?: string;
  /** Ids das fontes que as ferramentas devolveram NESTA execução. */
  sourcesThisRun: string[];
  /** Branches, tarefas ou PRs com liberação real e válida para quem pergunta. */
  releasedTargets: string[];
  /** Números que vieram das regras de `packages/domain` nesta execução; qualquer outra quantidade é recusada. */
  allowedNumbers?: string[];
}

/** Validador em código (etapa 6). Recusa a resposta se houver qualquer issue. */
export type AnswerValidator = (out: AnswerOutput, ctx: ValidatorContext) => ValidationIssue[];

export { validateAnswer } from "./validator.ts";
export { isWhoKnowsQuestion, topicPhrase } from "./who-knows.ts";
export { createAnswer, type AnswerDeps, type ModelCall } from "./answer.ts";
export type { AgentData, ExpertiseOverride, OrgSettings } from "./data.ts";
export {
  CONFIRM_ACTION_ID,
  createEndOfDay,
  draftMessage,
  noteConfirmAction,
  type ConfirmOutcome,
  type DailyNoteStore,
  type DraftOutcome,
  type EndOfDay,
  type EndOfDayDeps,
  type NoteOutbox,
  type NotePatch,
  type StoredDailyNote,
} from "./daily-note.ts";
export {
  createNightReview,
  reviewComment,
  validFindings,
  type BatchApi,
  type Finding,
  type NightReview,
  type NightReviewDeps,
  type PrDiff,
  type ReviewSource,
  type ReviewStore,
} from "./night-review.ts";
export { activityCounts, createDaySummary, summaryMessage, summaryRequest, SUMMARY_SYSTEM, type DailyArtifactStore, type DaySummary, type DaySummaryDeps, type StoredArtifact, type SummaryOutcome } from "./day-summary.ts";
export { runTriage, triageRequest, validTriage, TRIAGE_SYSTEM, type TriageInput, type TriageModel, type TriageOutcome, type TriageRequest } from "./triage.ts";
export { createMorningPlan, planMessage, type MorningPlan, type MorningPlanDeps, type PlanStore, type StoredPlan } from "./morning-plan.ts";
export {
  createFix,
  draftBody,
  FIX_APPROVE_ACTION_ID,
  FIX_DECISION_TEXT,
  FIX_DECLINE_ACTION_ID,
  fixClick,
  fixReadyMessage,
  validFixReport,
  type Fix,
  type FixCandidate,
  type FixCodeHost,
  type FixDecisionOutcome,
  type FixDeps,
  type FixOutcome,
  type FixReport,
  type FixSandbox,
  type FixSandboxInput,
  type FixSandboxResult,
  type FixState,
  type FixStore,
  type StoredFix,
} from "./fix.ts";
export {
  absenceTitle,
  createRedistribution,
  planText,
  type DecisionOutcome,
  type ItemState,
  type NewPlanItem,
  type PlanChoice,
  type PlanState,
  type PlanTrigger,
  type ProposeOutcome,
  type Redistribution,
  type RedistributionDeps,
  type RedistributionStore,
  type StoredAbsence,
  type StoredPlanItem,
  type StoredRedistribution,
} from "./redistribution.ts";
export {
  createWeeklyReport,
  noticeText,
  reportDocument,
  reportTextIssues,
  ruleReportText,
  type BuildOutcome,
  type NewReport,
  type ReportDocument,
  type ReportStore,
  type StoredReport,
  type WeeklyReport,
  type WeeklyReportDeps,
} from "./report.ts";

export { createGains, type BaselineOutcome, type Gains, type GainsDeps, type GainsHistory, type GainsStore, type GainsView } from "./gains.ts";
export { createAwayDigest, digestMessage, type AwayDigest, type AwayDigestDeps, type DigestOutcome, type DigestStore } from "./away-digest.ts";

/**
 * Fluxo de resposta (F2) com as dependências padrão: Postgres (DATABASE_URL) e a chave da empresa
 * (ANTHROPIC_API_KEY). Sem chave, responde por regra. O import é tardio para o pacote seguir leve no navegador.
 */
export async function answer(req: AnswerRequest): Promise<AnswerResult> {
  const { defaultAnswer } = await import("./server.ts");
  return (await defaultAnswer())(req);
}
