// Adaptador do GitHub (GitHub App) para a porta CodeHost, por HTTP, sem SDK.
// Token de instalação de 1 hora, renovado num só lugar. Somente leitura: escrever é com packages/actions.
import { createSign } from "node:crypto";
import type { CodeHost, CodeWriter } from "./index.ts";
import { checksStateOf } from "./github.ts";
import { taskKeyFrom, type ChecksState, type ExternalPullRequest, type LivePullRequest } from "./normalized.ts";
import { RefreshingToken } from "./tokens.ts";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class GithubApiError extends Error {
  override name = "GithubApiError";
  constructor(
    readonly status: number,
    readonly path: string,
    detail = "",
  ) {
    super(`GitHub ${status} em ${path}${detail ? `: ${detail}` : ""}`);
  }
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** JWT RS256 do app (válido por 9 minutos, com 60 s de folga para relógios adiantados). */
export function appJwt(appId: string, privateKeyPem: string, nowS = Math.floor(Date.now() / 1000)): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iat: nowS - 60, exp: nowS + 540, iss: appId }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKeyPem);
  return `${head}.${body}.${b64url(sig)}`;
}

/** A chave privada costuma vir de variável de ambiente com "\n" escapado. */
export const normalizePem = (pem: string) => pem.replace(/\\n/g, "\n").trim();

export interface GithubAppOptions {
  appId: string;
  privateKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Uma entrega de webhook registrada pelo GitHub. */
export interface WebhookDelivery {
  id: string;
  guid: string;
  status_code: number;
  delivered_at?: string;
}

/** Só as entregas que nunca tiveram sucesso, uma vez cada (o GitHub não reenvia sozinho). */
export function selectDeliveriesToRetry(deliveries: WebhookDelivery[]): WebhookDelivery[] {
  const ok = new Set(deliveries.filter((d) => d.status_code >= 200 && d.status_code < 300).map((d) => d.guid));
  const seen = new Set<string>();
  return deliveries.filter((d) => {
    if (ok.has(d.guid) || seen.has(d.guid)) return false;
    seen.add(d.guid);
    return true;
  });
}

export class GithubApp {
  readonly fetch: FetchLike;
  readonly base: string;
  readonly timeoutMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly pem: string;
  private readonly tokens = new Map<string, RefreshingToken>();

  constructor(private readonly opts: GithubAppOptions) {
    this.fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.base = opts.baseUrl ?? "https://api.github.com";
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
    this.pem = normalizePem(opts.privateKey);
  }

  jwt(): string {
    return appJwt(this.opts.appId, this.pem, Math.floor(this.now() / 1000));
  }

  /** Chamada autenticada. Respeita o limite de taxa: espera até 10 s uma vez; acima disso, falha. */
  async request<T>(path: string, auth: () => Promise<string>, init: { method?: string; body?: unknown } = {}): Promise<{ data: T; headers: Headers }> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${this.base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${await auth()}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const limited = res.status === 429 || (res.status === 403 && (res.headers.get("retry-after") || res.headers.get("x-ratelimit-remaining") === "0"));
      if (limited && attempt === 0) {
        const retryAfter = Number(res.headers.get("retry-after") ?? NaN);
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? NaN) * 1000 - this.now();
        const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : reset;
        if (Number.isFinite(wait) && wait <= 10_000) {
          await this.sleep(Math.max(wait, 0));
          continue;
        }
      }
      if (!res.ok) throw new GithubApiError(res.status, path, limited ? "limite de taxa" : ((await res.json().catch(() => ({}))) as { message?: string }).message ?? "");
      // 202/204 podem vir sem corpo (reenvio de entrega, por exemplo).
      const text = await res.text();
      const data = (text ? JSON.parse(text) : undefined) as T;
      return { data, headers: res.headers };
    }
  }

  /** Token da instalação, guardado até perto de vencer e com uma busca de cada vez. */
  installationToken(installationId: string): Promise<string> {
    let t = this.tokens.get(installationId);
    if (!t) {
      t = new RefreshingToken(async () => {
        const { data } = await this.request<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, async () => this.jwt(), { method: "POST" });
        return { token: data.token, expiresAt: Date.parse(data.expires_at) };
      }, 5 * 60_000, this.now);
      this.tokens.set(installationId, t);
    }
    return t.get();
  }

  /** Reconciliação: pede de novo as entregas que falharam (até 100 mais recentes). */
  async redeliverFailedWebhooks(): Promise<number> {
    const { data } = await this.request<WebhookDelivery[]>("/app/hook/deliveries?per_page=100", async () => this.jwt());
    let n = 0;
    for (const d of selectDeliveriesToRetry(data)) {
      await this.request(`/app/hook/deliveries/${d.id}/attempts`, async () => this.jwt(), { method: "POST" });
      n++;
    }
    return n;
  }

  forInstallation(installationId: string): GithubCodeHost {
    return new GithubCodeHost(this, installationId);
  }
}

const actor = (u?: { login: string; id: number } | null) => (u ? { platform: "github" as const, externalId: String(u.id), login: u.login } : undefined);

function toPr(repo: string, pr: any): ExternalPullRequest {
  return {
    repository: repo,
    number: pr.number,
    title: pr.title,
    author: actor(pr.user),
    state: pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open",
    branch: pr.head.ref,
    headSha: pr.head.sha,
    taskKey: taskKeyFrom(pr.head.ref, pr.title),
    reviewers: (pr.requested_reviewers ?? []).map((u: any) => actor(u)!),
    openedAt: new Date(pr.created_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
    updatedAt: new Date(pr.updated_at ?? pr.created_at),
  };
}

/** PRs com até 3.000 arquivos: acima disso o GitHub corta e a análise automática não roda. */
const MAX_FILE_PAGES = 30;

export class GithubCodeHost implements CodeHost, CodeWriter {
  constructor(
    private readonly app: GithubApp,
    readonly installationId: string,
  ) {}

  private get<T>(path: string) {
    return this.app.request<T>(path, () => this.app.installationToken(this.installationId));
  }

  /** 404 vira null: "não existe" é resposta, não erro. */
  private async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return (await this.get<T>(path)).data;
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 404) return null;
      throw err;
    }
  }

  async getPullRequest(repo: string, number: number): Promise<LivePullRequest | null> {
    const pr = await this.getOrNull<any>(`/repos/${repo}/pulls/${number}`);
    if (!pr) return null;
    const files: string[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const { data } = await this.get<{ filename: string }[]>(`/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
      files.push(...data.map((f) => f.filename));
      if (data.length < 100) break;
    }
    // mergeable pode vir nulo enquanto o GitHub calcula: o agente diz "ainda em cálculo", sem afirmar.
    return { ...toPr(repo, pr), files, mergeable: typeof pr.mergeable === "boolean" ? pr.mergeable : null };
  }

  async findPullRequestByBranch(repo: string, branch: string): Promise<ExternalPullRequest | null> {
    const owner = repo.split("/")[0];
    const { data } = await this.get<any[]>(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=5&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    return data[0] ? toPr(repo, data[0]) : null;
  }

  async getLastCommitAt(repo: string, branch: string): Promise<Date | null> {
    const c = await this.getOrNull<any>(`/repos/${repo}/commits/${encodeURIComponent(branch)}`);
    const at = c?.commit?.committer?.date ?? c?.commit?.author?.date;
    return at ? new Date(at) : null;
  }

  async listOpenPullRequests(repo: string): Promise<ExternalPullRequest[]> {
    const out: ExternalPullRequest[] = [];
    for (let page = 1; page <= 10; page++) {
      const { data } = await this.get<any[]>(`/repos/${repo}/pulls?state=open&per_page=100&page=${page}`);
      out.push(...data.map((pr) => toPr(repo, pr)));
      if (data.length < 100) break;
    }
    return out;
  }

  /** Checks de um commit ao vivo: só estado, nomes que falharam e o link, nunca logs. */
  async getChecks(repo: string, ref: string): Promise<{ state: ChecksState | "none"; total: number; failed: string[]; running: number; url: string }> {
    const { data } = await this.get<{ total_count: number; check_runs: { name: string; status: string; conclusion: string | null }[] }>(
      `/repos/${repo}/commits/${encodeURIComponent(ref)}/check-runs?per_page=100`,
    );
    const runs = data.check_runs;
    const failed = runs.filter((r) => r.status === "completed" && checksStateOf(r.conclusion) === "failure").map((r) => r.name);
    const running = runs.filter((r) => r.status !== "completed").length;
    const state: ChecksState | "none" = runs.length === 0 ? "none" : failed.length ? "failure" : running ? "pending" : runs.every((r) => checksStateOf(r.conclusion) === "neutral") ? "neutral" : "success";
    return { state, total: data.total_count, failed, running, url: `https://github.com/${repo}/commit/${ref}/checks` };
  }

  // ---------- Escritas (só packages/actions, depois de aprovação)

  async comment(repo: string, number: number, body: string): Promise<{ id: string }> {
    const { data } = await this.app.request<{ id: number }>(`/repos/${repo}/issues/${number}/comments`, () => this.app.installationToken(this.installationId), { method: "POST", body: { body } });
    return { id: String(data.id) };
  }

  async requestReviewers(repo: string, number: number, logins: string[]): Promise<void> {
    if (logins.length === 0) return;
    await this.app.request(`/repos/${repo}/pulls/${number}/requested_reviewers`, () => this.app.installationToken(this.installationId), { method: "POST", body: { reviewers: logins } });
  }

  /** Repositórios a que a instalação tem acesso. */
  async listRepositories(): Promise<string[]> {
    const out: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const { data } = await this.get<{ repositories: { full_name: string }[] }>(`/installation/repositories?per_page=100&page=${page}`);
      out.push(...data.repositories.map((r) => r.full_name));
      if (data.repositories.length < 100) break;
    }
    return out;
  }

  /** Commits desde uma data (reconciliação: 7 dias), no formato do aviso de push. */
  async listCommitsSince(repo: string, since: Date, maxPages = 3): Promise<{ id: string; message: string; timestamp: string; author?: { username?: string } }[]> {
    const out: { id: string; message: string; timestamp: string; author?: { username?: string } }[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const { data } = await this.get<any[]>(`/repos/${repo}/commits?since=${since.toISOString()}&per_page=100&page=${page}`);
      for (const c of data) out.push({ id: c.sha, message: c.commit.message, timestamp: c.commit.author?.date ?? c.commit.committer?.date, ...(c.author?.login ? { author: { username: c.author.login } } : {}) });
      if (data.length < 100) break;
    }
    return out;
  }
}
