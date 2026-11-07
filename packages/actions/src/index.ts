// Única saída que altera GitHub, Linear ou Slack — sempre via outbox_actions e só depois de aprovação.
// Exceções registradas (sem aprovação): comentário da análise noturna no PR (nunca aprovação) e o espelho das
// notas no repositório brains, que só copia notas que já valem no Echo e nunca sobrescreve uma edição do Git.

export type ActionType =
  | "linear.assign"
  | "linear.comment"
  | "github.comment"
  | "github.set_reviewers"
  | "github.draft_pr"
  | "github.merge_fix"
  | "github.mirror_write"
  | "slack.post"
  | "slack.dm";

export interface OutboxAction<P = Record<string, unknown>> {
  type: ActionType;
  target: string; // ex.: "linear:ECH-133", "github:org-teste/app#42"
  payload: P;
  /** Chave única: a mesma ação nunca roda duas vezes. */
  idempotencyKey: string;
  approvedBy?: string; // obrigatório quando REQUIRES_APPROVAL[type]
}

export interface ActionExecutor {
  enqueue(orgId: string, action: OutboxAction): Promise<{ id: string; duplicate: boolean }>;
  /** Executa ações aprovadas pendentes; chamado pelo worker. */
  drain(orgId: string): Promise<{ done: number; failed: number }>;
}

export const REQUIRES_APPROVAL: Record<ActionType, boolean> = {
  "linear.assign": true,
  "linear.comment": true,
  "github.comment": false,
  "github.set_reviewers": true,
  "github.draft_pr": false,
  "github.merge_fix": true,
  "github.mirror_write": false,
  "slack.post": false,
  "slack.dm": false,
};

export { approveAction, drainActions, enqueueAction, MAX_ATTEMPTS, orgsWithApprovedActions, PermanentActionError, releaseStuckActions, type ActionPayloads, type ExecutorDeps } from "./executor.ts";
export { writersFromEnv, type PlatformEnv } from "./writers.ts";
