// Adaptador do Linear (app OAuth com actor=app) para a porta IssueTracker, por GraphQL.
// Token de aplicativo renovado num só lugar. Somente leitura: escrever é com packages/actions.
import type { IssueTracker } from "./index.ts";
import { linearState } from "./linear.ts";
import type { ExternalTask } from "./normalized.ts";
import { RefreshingToken } from "./tokens.ts";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class LinearApiError extends Error {
  override name = "LinearApiError";
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`Linear ${status}: ${detail}`);
  }
}

const ISSUE_FIELDS = "id identifier title dueDate estimate updatedAt completedAt assignee { id } state { type name } labels(first: 20) { nodes { name } }";
const CLOSED_TYPES = '["completed", "canceled", "duplicate"]';
const ISSUE_QUERY = `query($id: String!) { issue(id: $id) { ${ISSUE_FIELDS} } }`;
const OPEN_QUERY = `query($after: String) {
  issues(first: 50, after: $after, filter: { state: { type: { nin: ${CLOSED_TYPES} } } }) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } }
}`;
const CLOSED_SINCE_QUERY = `query($after: String, $since: DateTimeOrDuration!) {
  issues(first: 50, after: $after, filter: { state: { type: { in: ${CLOSED_TYPES} } }, updatedAt: { gt: $since } }) { nodes { ${ISSUE_FIELDS} } pageInfo { hasNextPage endCursor } }
}`;
const MAX_PAGES = 10;

export function toTask(n: any): ExternalTask {
  return {
    key: n.identifier,
    linearId: n.id,
    title: n.title,
    assignee: n.assignee?.id ? { platform: "linear", externalId: n.assignee.id } : undefined,
    state: n.state?.type === "duplicate" ? "canceled" : linearState(n.state?.type ?? "backlog", n.state?.name),
    dueDate: n.dueDate ?? undefined,
    size: typeof n.estimate === "number" ? n.estimate : undefined,
    labels: (n.labels?.nodes ?? []).map((l: { name: string }) => l.name),
    updatedAt: new Date(n.updatedAt),
    completedAt: n.completedAt ? new Date(n.completedAt) : undefined,
  };
}

export interface LinearOptions {
  /** App OAuth instalado como app: o token vem por client_credentials. */
  clientId?: string;
  clientSecret?: string;
  /** Ou um token já pronto (chave pessoal de API, só para desenvolvimento). */
  token?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: () => number;
}

export class LinearTracker implements IssueTracker {
  private readonly fetch: FetchLike;
  private readonly timeoutMs: number;
  private readonly token: RefreshingToken;

  constructor(private readonly opts: LinearOptions) {
    this.fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.timeoutMs = opts.timeoutMs ?? 15_000;
    if (opts.token) {
      const fixed = opts.token;
      this.token = new RefreshingToken(async () => ({ token: fixed, expiresAt: Number.MAX_SAFE_INTEGER }), 0, opts.now);
    } else if (opts.clientId && opts.clientSecret) {
      // Token de aplicativo vence em horas; renova com uma hora de folga, uma busca de cada vez.
      this.token = new RefreshingToken(() => this.fetchAppToken(), 60 * 60_000, opts.now);
    } else {
      throw new Error("LinearTracker precisa de clientId e clientSecret, ou de um token");
    }
  }

  private async fetchAppToken(): Promise<{ token: string; expiresAt: number }> {
    const res = await this.fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "read,write" }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new LinearApiError(res.status, "token recusado");
    const body = (await res.json()) as { access_token: string; expires_in: number };
    return { token: body.access_token, expiresAt: (this.opts.now ?? Date.now)() + body.expires_in * 1000 };
  }

  /** Consulta GraphQL. Um 401 renova o token e tenta mais uma vez. */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await this.token.get()}` },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status === 401 && attempt === 0 && !this.opts.token) {
        this.token.invalidate();
        continue;
      }
      const body = (await res.json().catch(() => ({}))) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
      if (!res.ok || body.errors?.length) {
        const first = body.errors?.[0];
        throw new LinearApiError(res.status, first ? `${first.extensions?.code ?? ""} ${first.message}`.trim() : "falha na consulta");
      }
      return body.data as T;
    }
  }

  async getTask(key: string): Promise<ExternalTask | null> {
    try {
      const d = await this.query<{ issue: any | null }>(ISSUE_QUERY, { id: key });
      return d.issue ? toTask(d.issue) : null;
    } catch (err) {
      // Identificador inexistente: o Linear responde com erro de entidade não encontrada.
      if (err instanceof LinearApiError && /not.?found|entity/i.test(err.message)) return null;
      throw err;
    }
  }

  private async list(query: string, variables: Record<string, unknown>): Promise<{ tasks: ExternalTask[]; truncated: boolean }> {
    const tasks: ExternalTask[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const d: { issues: { nodes: any[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await this.query(query, { ...variables, after });
      tasks.push(...d.issues.nodes.map(toTask));
      if (!d.issues.pageInfo.hasNextPage) return { tasks, truncated: false };
      after = d.issues.pageInfo.endCursor;
    }
    return { tasks, truncated: true };
  }

  listOpenTasks(): Promise<{ tasks: ExternalTask[]; truncated: boolean }> {
    return this.list(OPEN_QUERY, {});
  }

  /** Reconciliação: tarefas encerradas desde uma data (7 dias). */
  listClosedTasksSince(since: Date): Promise<{ tasks: ExternalTask[]; truncated: boolean }> {
    return this.list(CLOSED_SINCE_QUERY, { since: since.toISOString() });
  }

  /** Organização do app: o id vai para installation_routes (DEMO_LINEAR_ORG_ID). */
  async organization(): Promise<{ id: string; name: string }> {
    const d = await this.query<{ organization: { id: string; name: string } }>("query { organization { id name } }");
    return d.organization;
  }
}
