// Portas das plataformas externas. Frente: Integrações implementa os adaptadores.
// Os agentes usam SÓ estas interfaces (nunca Octokit/Slack/Linear direto).
import type { ExternalPullRequest, ExternalTask, LivePullRequest } from "./normalized.ts";

/** Nenhuma porta de leitura escreve. Escrita só via packages/actions, depois de aprovação. */
// Retornam pessoas como identificadores EXTERNOS; quem chama resolve pela tabela identities.
export interface CodeHost {
  getPullRequest(repo: string, number: number): Promise<LivePullRequest | null>;
  /** PR mais recente da branch, aberto ou não. */
  findPullRequestByBranch(repo: string, branch: string): Promise<ExternalPullRequest | null>;
  getLastCommitAt(repo: string, branch: string): Promise<Date | null>;
  listOpenPullRequests(repo: string): Promise<ExternalPullRequest[]>;
}

export interface IssueTracker {
  getTask(key: string): Promise<ExternalTask | null>;
  /** Até 10 páginas de 50; `truncated` avisa que havia mais. */
  listOpenTasks(): Promise<{ tasks: ExternalTask[]; truncated: boolean }>;
}

/**
 * Escritas nas plataformas. SÓ packages/actions usa, e só para ações aprovadas no outbox.
 * Os agentes recebem as portas de leitura acima, nunca estas.
 */
export interface CodeWriter {
  comment(repo: string, number: number, body: string): Promise<{ id: string }>;
  requestReviewers(repo: string, number: number, logins: string[]): Promise<void>;
}
export interface IssueWriter {
  assignIssue(linearIssueId: string, assigneeLinearUserId: string | null): Promise<void>;
  comment(linearIssueId: string, body: string): Promise<{ id: string }>;
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
export { commitEvent, githubRouteKey, normalizeGithub, parseCoauthors, type GhCommit } from "./github.ts";
export { linearRouteKey, linearState, normalizeLinear } from "./linear.ts";
export { HELP_REACTIONS, isWhoKnows, normalizeSlack, slackShouldKeep, type SlackEntryContext } from "./slack.ts";
export { ingest, type IngestResult } from "./ingest.ts";
export { processInbox, receive, routeOrg, slackBotUserIdOf, type Delivery, type InboxJob, type InboxSource, type ProcessOptions } from "./inbox.ts";
export { answerBlocks, dailyNoteDraftBlocks, fitText, respondToInteraction, SLACK_ACTIONS, SlackApiError, SlackChat, sourcesLine, type SlackClientOptions } from "./slack-client.ts";
export { RefreshingToken } from "./tokens.ts";
export { appJwt, GithubApiError, GithubApp, GithubCodeHost, normalizePem, selectDeliveriesToRetry, type GithubAppOptions, type WebhookDelivery } from "./github-client.ts";
export { LinearApiError, LinearTracker, toTask, type LinearOptions } from "./linear-client.ts";
export { BACKFILL_MS, MAX_DETAILS_PER_REPO, openPullRequestNumbers, reconcileGithub, reconcileLinear, type GithubReconciler, type GithubReconcileResult, type LinearReconciler } from "./reconcile.ts";
export { connectedOrgs, githubForOrg, orgRoute, platformsFromEnv, type PlatformEnv, type Platforms } from "./platforms.ts";
export { applyHrEvent, hrSecret, parseHrEvent, rotateHrSecret, type HrEvent, type HrResult } from "./hr.ts";
export { exchangeSlackCode, SlackLoginError, slackAuthorizeUrl, type SlackIdentity, type SlackOidcConfig } from "./slack-oidc.ts";
export { loadPanelPerson, resolvePanelPerson, type PanelLogin, type PanelPerson } from "./panel-login.ts";
