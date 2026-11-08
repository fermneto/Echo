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

/** Leitura do repositório do espelho das notas (etapa 14). */
export interface RepoFiles {
  /** Arquivos da branch padrão: caminho → sha do blob. Repositório vazio = mapa vazio. */
  listFiles(repo: string): Promise<{ files: Map<string, string>; truncated: boolean }>;
  readBlob(repo: string, sha: string): Promise<string>;
  /**
   * Quem mudou o caminho desde a última sincronização (`syncedSha`, o blob que o Echo conhece; null = nunca).
   * Só vale commit verificado (assinado pela conta do GitHub): o e-mail do autor qualquer um define.
   */
  editsSince(repo: string, path: string, syncedSha: string | null): Promise<PathEdits>;
}

/**
 * Commits que mexeram num arquivo desde a última sincronização, do mais novo ao mais antigo.
 * - ok: todos verificados; `logins` de quem fez cada um.
 * - nao_verificado: algum commit sem assinatura verificada (ou sem conta); a edição não é aceita.
 * - historico_longo: mais commits do que se confere de uma vez; a edição não é aceita.
 */
export type PathEdits = { kind: "ok"; logins: string[] } | { kind: "nao_verificado" } | { kind: "historico_longo" };

/** Commit como o GitHub devolve em /commits, só o que importa para saber quem o fez. */
export interface CommitIdentity {
  author: { login?: string } | null;
  committer: { login?: string } | null;
  commit: { verification?: { verified?: boolean } | null };
}

/**
 * Conta que responde por um commit, ou null se não dá para confiar.
 * Commit verificado: a assinatura é de uma conta e o e-mail de quem fez o commit é dela (committer).
 * Edição pelo site do GitHub: quem assina é o próprio GitHub (web-flow) e o autor é a pessoa logada.
 */
export function trustedLogin(c: CommitIdentity): string | null {
  if (c.commit.verification?.verified !== true) return null;
  const committer = c.committer?.login;
  if (!committer) return null;
  if (committer === "web-flow") return c.author?.login ?? null;
  return committer;
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
  /**
   * Cria ou atualiza um arquivo (espelho das notas). `previousSha` é o blob que se espera encontrar:
   * se o arquivo mudou no meio, o GitHub recusa (FileChangedError) e nada é sobrescrito.
   */
  putFile(repo: string, path: string, content: string, message: string, previousSha?: string): Promise<{ sha: string }>;
  /** Apaga um arquivo do espelho. Se o arquivo mudou (sha diferente), FileChangedError; se já não existe, nada. */
  deleteFile(repo: string, path: string, sha: string, message: string): Promise<void>;
  /** Rascunho da correção: commit com o diff sobre `baseSha`, branch do Echo e PR em rascunho para `base`. */
  createFixDraft(input: { repo: string; base: string; baseSha: string; branch: string; title: string; body: string; patch: string }): Promise<{ number: number; headSha: string }>;
  /** Leva a versão aprovada do rascunho (`sha`) para a branch do PR (`base`). */
  mergeFix(input: { repo: string; base: string; sha: string; message: string }): Promise<{ sha: string | null }>;
}

/** O arquivo mudou no repositório desde a última leitura: a escrita foi recusada, sem sobrescrever. */
export class FileChangedError extends Error {
  override name = "FileChangedError";
}
export interface IssueWriter {
  assignIssue(linearIssueId: string, assigneeLinearUserId: string | null): Promise<void>;
  comment(linearIssueId: string, body: string): Promise<{ id: string }>;
}

export type Presence = "active" | "away" | "unknown";

export interface ChatPlatform {
  /** Lido só na menção, com limite de 1,5 s. NUNCA gravar nem logar o resultado. */
  getPresence(userExternalId: string, timeoutMs?: number): Promise<Presence>;
  /** Mensagem efêmera só para uma pessoa (ex.: aviso de pergunta perdida). O Slack não deixa o bot apagá-la. */
  postEphemeral(channel: string, userExternalId: string, text: string): Promise<void>;
  /** Aviso temporário no tópico ("consultando…"), apagado com deleteMessage depois da resposta. */
  postNotice?(input: { channel: string; threadTs?: string; agentName: string; text: string; iconUrl?: string }): Promise<{ channel: string; ts: string } | null>;
  /** Apaga uma mensagem do próprio bot. */
  deleteMessage?(channel: string, ts: string): Promise<void>;
  /** Resposta do agente, identificada (ex.: "Agente de Fernando"). Blocos prontos em answerBlocks. */
  postAgentReply(input: { channel: string; threadTs?: string; agentName: string; blocks?: unknown[]; text: string; iconUrl?: string }): Promise<{ ts: string }>;
  sendDm(userExternalId: string, input: { text: string; blocks?: unknown[] }): Promise<void>;
  /** Arquivo (ex.: imagem do resumo do dia) na conversa privada. Precisa do escopo files:write. */
  sendDmFile?(userExternalId: string, input: { filename: string; data: Uint8Array; title: string; comment: string; altText?: string }): Promise<void>;
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
export { checksStateOf, commitEvent, githubRouteKey, normalizeGithub, parseCoauthors, type GhCommit } from "./github.ts";
export { linearRouteKey, linearState, normalizeLinear } from "./linear.ts";
export { HELP_REACTIONS, isWhoKnows, normalizeSlack, slackShouldKeep, type SlackEntryContext } from "./slack.ts";
export { ingest, type IngestResult } from "./ingest.ts";
export { processInbox, receive, routeOrg, slackBotUserIdOf, type Delivery, type InboxJob, type InboxSource, type ProcessOptions } from "./inbox.ts";
export { answerBlocks, dailyNoteDraftBlocks, fitText, REPLY_TEXT, respondToInteraction, SLACK_ACTIONS, SlackApiError, SlackChat, sourcesLine, type ReplyLang, type SlackClientOptions } from "./slack-client.ts";
export { RefreshingToken } from "./tokens.ts";
export { appJwt, GithubApiError, GithubApp, GithubCodeHost, normalizePem, selectDeliveriesToRetry, type GithubAppOptions, type PullRequestHistory, type WebhookDelivery } from "./github-client.ts";
export { LinearApiError, LinearTracker, toTask, type LinearOptions } from "./linear-client.ts";
export { BACKFILL_MS, MAX_DETAILS_PER_REPO, openPullRequestNumbers, reconcileGithub, reconcileLinear, type GithubReconciler, type GithubReconcileResult, type LinearReconciler } from "./reconcile.ts";
export { calendarsForOrg, connectedOrgs, githubForOrg, orgRoute, platformsFromEnv, type PlatformEnv, type Platforms } from "./platforms.ts";
export { applyHrEvent, hrSecret, parseHrEvent, rotateHrSecret, type HrEvent, type HrResult } from "./hr.ts";
export { exchangeSlackCode, SlackLoginError, slackAuthorizeUrl, type SlackIdentity, type SlackOidcConfig } from "./slack-oidc.ts";
export { loadPanelPerson, resolvePanelPerson, type PanelLogin, type PanelPerson } from "./panel-login.ts";
export { CalendarApiError, GoogleCalendar, MicrosoftCalendar, type CalendarSource, type GoogleCalendarOptions, type MicrosoftCalendarOptions, type OutOfOffice, type WorkingHours } from "./calendar.ts";
export { acceptSuggestedWorkHours, confirmCalendarAbsence, currentAbsences, LONG_ABSENCE_MS, syncCalendar, type CalendarSyncResult } from "./calendar-sync.ts";
export { normalizeVercel, signVercel, vercelRouteKey, verifyVercel } from "./vercel.ts";
export { ciStatus, deployStatus, type CiStatus, type DeployStatus, type LiveChecks } from "./pipeline.ts";
