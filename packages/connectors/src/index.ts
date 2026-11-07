// Portas das plataformas externas. Frente: Integrações implementa os adaptadores.
// Os agentes usam SÓ estas interfaces (nunca Octokit/Slack/Linear direto).
import type { PullRequest, Task, WorkEvent } from "@echo/domain";

/** Nenhuma porta de leitura escreve. Escrita só via packages/actions, depois de aprovação. */
export interface CodeHost {
  getPullRequest(repo: string, number: number): Promise<PullRequest | null>;
  findPullRequestByBranch(repo: string, branch: string): Promise<PullRequest | null>;
  getLastCommitAt(repo: string, branch: string): Promise<Date | null>;
  listOpenPullRequests(repo: string): Promise<PullRequest[]>;
}

export interface IssueTracker {
  getTask(key: string): Promise<Task | null>;
  listOpenTasks(): Promise<Task[]>;
}

export type Presence = "active" | "away" | "unknown";
export interface ChatMessage {
  channel: string;
  ts: string;
  threadTs?: string;
  userExternalId: string;
  text: string;
  mentions: string[]; // ids externos citados
  mentionsBot: boolean;
  isDm: boolean;
}
export interface ChatPlatform {
  /** Lido só na menção, com limite de 1,5 s. NUNCA gravar nem logar o resultado. */
  getPresence(userExternalId: string, timeoutMs?: number): Promise<Presence>;
  /** Mensagem efêmera "consultando…" para quem chamou. */
  postEphemeral(channel: string, userExternalId: string, text: string): Promise<void>;
  /** Resposta do agente, identificada (ex.: "Agente de Fernando"). */
  postAgentReply(input: { channel: string; threadTs?: string; agentName: string; blocks: unknown[]; text: string }): Promise<{ ts: string }>;
  sendDm(userExternalId: string, input: { text: string; blocks?: unknown[] }): Promise<void>;
}

export interface HrAbsenceEvent {
  id: string;
  employeeId: string;
  startsAt: Date;
  endsAt: Date;
  kind: "vacation" | "leave";
  action?: "cancel";
}
export interface HrSource {
  parse(rawBody: string, headers: Record<string, string>): HrAbsenceEvent;
}

/** Evento normalizado a partir de um webhook (F1). */
export type NormalizedEvent =
  | { kind: "work_event"; event: WorkEvent; externalLogin?: string }
  | { kind: "task_upsert"; task: Task; externalUpdatedAt: Date }
  | { kind: "pr_upsert"; pr: PullRequest }
  | { kind: "chat_message"; message: ChatMessage }
  | { kind: "reaction"; channel: string; ts: string; reaction: string; userExternalId: string; itemUserExternalId: string }
  | { kind: "ignored"; reason: string };

/** Webhook verificado e pronto para gravar em inbox_events. */
export interface VerifiedDelivery {
  source: "github" | "slack" | "linear" | "rh";
  deliveryId: string;
  payload: unknown;
}
