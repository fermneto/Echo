// Portas das plataformas externas. Frente: Integrações implementa os adaptadores.
// Os agentes usam SÓ estas interfaces (nunca Octokit/Slack/Linear direto).
import type { PullRequest, Task } from "@echo/domain";

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

export interface ChatPlatform {
  /** Lido só na menção, com limite de 1,5 s. NUNCA gravar nem logar o resultado. */
  getPresence(userExternalId: string, timeoutMs?: number): Promise<Presence>;
  /** Mensagem efêmera "consultando…" para quem chamou. */
  postEphemeral(channel: string, userExternalId: string, text: string): Promise<void>;
  /** Resposta do agente, identificada (ex.: "Agente de Fernando"). Blocos prontos em answerBlocks. */
  postAgentReply(input: { channel: string; threadTs?: string; agentName: string; blocks?: unknown[]; text: string; iconUrl?: string }): Promise<{ ts: string }>;
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

/** Webhook verificado e pronto para gravar em inbox_events. */
export interface VerifiedDelivery {
  source: "github" | "slack" | "linear" | "rh";
  deliveryId: string;
  payload: unknown;
}

export * from "./normalized.ts";
export { TokenCipher } from "./crypto.ts";
export { sign, verifyGithub, verifyHr, verifyLinear, verifySlack, type Verification } from "./signatures.ts";
export { githubRouteKey, normalizeGithub, parseCoauthors } from "./github.ts";
export { linearRouteKey, linearState, normalizeLinear } from "./linear.ts";
export { HELP_REACTIONS, isWhoKnows, normalizeSlack, slackShouldKeep, type SlackEntryContext } from "./slack.ts";
export { ingest, type IngestResult } from "./ingest.ts";
export { processInbox, receive, routeOrg, slackBotUserIdOf, type Delivery, type InboxJob, type InboxSource, type ProcessOptions } from "./inbox.ts";
export { answerBlocks, dailyNoteDraftBlocks, fitText, respondToInteraction, SLACK_ACTIONS, SlackApiError, SlackChat, sourcesLine, type SlackClientOptions } from "./slack-client.ts";
