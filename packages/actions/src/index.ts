// Única saída que altera GitHub, Linear ou Slack — sempre via outbox_actions e só depois de aprovação.
// Exceções registradas (sem aprovação): comentário da análise noturna no PR (nunca aprovação) e o espelho das
// notas no repositório brains, que só copia notas que toda a empresa já lê, nunca sobrescreve uma edição do Git
// e tira do repositório a nota que deixou de poder estar lá.

export type ActionType =
  | "linear.assign"
  | "linear.comment"
  | "github.comment"
  | "github.set_reviewers"
  | "github.draft_pr"
  | "github.merge_fix"
  | "github.mirror_write"
  | "github.mirror_delete"
  | "slack.post"
  | "slack.dm"
  | "slack.dm_image";

import type { ApprovalSource } from "./guards.ts";

export interface OutboxAction<P = Record<string, unknown>> {
  type: ActionType;
  target: string; // ex.: "linear:ECH-133", "github:org-teste/app#42"
  payload: P;
  /** Chave única: a mesma ação nunca roda duas vezes. */
  idempotencyKey: string;
  approvedBy?: string; // obrigatório quando REQUIRES_APPROVAL[type]
  /** Por onde a pessoa aprovou (vai para o audit_log junto com `approvedBy`). */
  approvalSource?: ApprovalSource;
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
  "github.mirror_delete": false,
  "slack.post": false,
  "slack.dm": false,
  "slack.dm_image": false,
};

export { approveAction, drainActions, enqueueAction, EXECUTABLE_TYPES, MAX_ATTEMPTS, noExecutorError, orgsWithApprovedActions, PermanentActionError, releaseStuckActions, retryActionsWithoutExecutor, type ActionPayloads, type ExecutorDeps } from "./executor.ts";
export { approvalAudit, draftPrRefusal, type ApprovalSource, type DraftPrPayload } from "./guards.ts";
export { writersFromEnv, type PlatformEnv } from "./writers.ts";
