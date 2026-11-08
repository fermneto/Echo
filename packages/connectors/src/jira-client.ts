// Adaptador do Jira Cloud (REST v3) para a porta IssueTracker, com as escritas de IssueWriter.
// Autenticação por e-mail e token de API de uma conta de serviço (Basic). Ler é livre; escrever (responsável
// e comentário) é só com packages/actions, depois de aprovação. A busca usa /rest/api/3/search/jql, com
// nextPageToken: a /rest/api/3/search antiga foi removida do Jira Cloud.
import type { IssueTracker, IssueWriter } from "./index.ts";
import { DEFAULT_STORY_POINTS_FIELD, JIRA_FIELDS, jiraTask } from "./jira.ts";
import type { ExternalTask } from "./normalized.ts";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class JiraApiError extends Error {
  override name = "JiraApiError";
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Jira ${status}: ${detail}`);
  }
}

export interface JiraOptions {
  /** Endereço do site, ex.: https://acme.atlassian.net */
  baseUrl: string;
  email: string;
  apiToken: string;
  /** Campo dos story points neste site (padrão: customfield_10016). */
  storyPointsField?: string;
  /** Filtro JQL extra (ex.: project in (ECH, PAG)), para importar só os projetos da equipe. */
  jql?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

const PAGE_SIZE = 50;
const MAX_PAGES = 10;

/** Texto simples no formato de documento do Jira (ADF), um parágrafo por linha. */
export function adfText(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((p) => ({ type: "paragraph", content: p ? [{ type: "text", text: p }] : [] }));
  return { type: "doc", version: 1, content: paragraphs };
}

/** Escapa um valor para aspas dentro de JQL. */
const jqlString = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export class JiraTracker implements IssueTracker, IssueWriter {
  /** Identidades do Echo usadas nas escritas: tarefa só vai para quem tem conta no Jira. */
  readonly platform = "jira" as const;
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly base: string;
  private readonly fields: string[];

  constructor(private readonly opts: JiraOptions) {
    if (!opts.baseUrl || !opts.email || !opts.apiToken) throw new Error("JiraTracker precisa de baseUrl, email e apiToken");
    this.fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.fields = [...JIRA_FIELDS, opts.storyPointsField ?? DEFAULT_STORY_POINTS_FIELD];
  }

  /** Site em minúsculas (ex.: acme.atlassian.net): a chave em installation_routes (DEMO_JIRA_SITE). */
  get site(): string {
    return new URL(this.base).host.toLowerCase();
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await this.fetch(`${this.base}${path}`, {
      method,
      headers: {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${this.opts.email}:${this.opts.apiToken}`).toString("base64")}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let detail = "falha na chamada";
      try {
        const e = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string> };
        detail = [...(e.errorMessages ?? []), ...Object.values(e.errors ?? {})].join("; ") || detail;
      } catch {
        // corpo sem JSON: fica a mensagem padrão
      }
      throw new JiraApiError(res.status, detail);
    }
    return text ? (JSON.parse(text) as T) : null;
  }

  private task = (issue: any): ExternalTask => jiraTask(issue, this.opts.storyPointsField ?? DEFAULT_STORY_POINTS_FIELD);

  async getTask(key: string): Promise<ExternalTask | null> {
    try {
      const issue = await this.request<any>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${this.fields.join(",")}`);
      return issue ? this.task(issue) : null;
    } catch (err) {
      if (err instanceof JiraApiError && err.status === 404) return null;
      throw err;
    }
  }

  private async search(jql: string): Promise<{ tasks: ExternalTask[]; truncated: boolean }> {
    const scope = this.opts.jql ? `(${this.opts.jql}) AND ` : "";
    const tasks: ExternalTask[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const d = await this.request<{ issues?: any[]; nextPageToken?: string; isLast?: boolean }>("POST", "/rest/api/3/search/jql", {
        jql: `${scope}${jql} ORDER BY updated DESC`,
        fields: this.fields,
        maxResults: PAGE_SIZE,
        ...(nextPageToken ? { nextPageToken } : {}),
      });
      tasks.push(...(d?.issues ?? []).map(this.task));
      // Sem token, acabou; isLast também encerra (há relatos de token sem isLast).
      if (!d?.nextPageToken || d.isLast) return { tasks, truncated: false };
      nextPageToken = d.nextPageToken;
    }
    return { tasks, truncated: true };
  }

  listOpenTasks(): Promise<{ tasks: ExternalTask[]; truncated: boolean }> {
    return this.search("statusCategory != Done");
  }

  /** Reconciliação: tarefas encerradas desde uma data (7 dias). */
  listClosedTasksSince(since: Date): Promise<{ tasks: ExternalTask[]; truncated: boolean }> {
    // JQL aceita "yyyy-MM-dd HH:mm" no fuso do usuário da API; um minuto de folga não duplica (o ingest é idempotente).
    const at = new Date(since.getTime() - 60_000).toISOString().slice(0, 16).replace("T", " ");
    return this.search(`statusCategory = Done AND updated >= ${jqlString(at)}`);
  }

  // ---------- Escritas (só packages/actions, depois de aprovação)

  /** `issueId` é o id guardado em tasks.linear_id; `accountId` vem de identities (platform "jira"). */
  async assignIssue(issueId: string, accountId: string | null): Promise<void> {
    await this.request("PUT", `/rest/api/3/issue/${encodeURIComponent(issueId)}/assignee`, { accountId });
  }

  async comment(issueId: string, body: string): Promise<{ id: string }> {
    const d = await this.request<{ id: string }>("POST", `/rest/api/3/issue/${encodeURIComponent(issueId)}/comment`, { body: adfText(body) });
    if (!d?.id) throw new JiraApiError(200, "comentário sem id");
    return { id: d.id };
  }

  /** Pessoas do site, para ligar identidades no cadastro (só contas de gente, ativas). */
  async listUsers(): Promise<{ id: string; name: string }[]> {
    const users = (await this.request<{ accountId: string; displayName: string; active: boolean; accountType: string }[]>("GET", "/rest/api/3/users/search?maxResults=200")) ?? [];
    return users.filter((u) => u.active && u.accountType === "atlassian").map((u) => ({ id: u.accountId, name: u.displayName }));
  }
}
