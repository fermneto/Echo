// Adaptador do GitHub (GitHub App) para a porta CodeHost, por HTTP, sem SDK.
// Token de instalação de 1 hora, renovado num só lugar. Somente leitura: escrever é com packages/actions.
import { createSign } from "node:crypto";
import { FileChangedError, trustedLogin, type CodeHost, type CodeWriter, type CommitIdentity, type PathEdits, type RepoFiles } from "./index.ts";
import { applyFilePatch, PatchConflictError, splitUnifiedDiff, type FixTarget, type PullHead } from "@echo/domain";
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

/** Commits por arquivo conferidos numa sincronização do espelho; acima disso a edição espera alguém olhar. */
const MIRROR_MAX_COMMITS = 10;

/** Histórico de um PR para a referência dos Ganhos: só datas e logins. */
export interface PullRequestHistory {
  repository: string;
  number: number;
  authorLogin?: string | undefined;
  openedAt: Date;
  mergedAt?: Date | undefined;
  reviews: { login: string; isBot: boolean; at: Date }[];
}

/** Diff de um PR (mesma forma de `PrDiff` em @echo/agents). */
export interface PullRequestDiff {
  headSha: string;
  files: { path: string; additions: number; deletions: number }[];
  totalChars: number;
  patch: string;
}

/** PRs com até 3.000 arquivos: acima disso o GitHub corta e a análise automática não roda. */
const MAX_FILE_PAGES = 30;

export class GithubCodeHost implements CodeHost, CodeWriter, RepoFiles {
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

  /**
   * Diff do PR para a revisão noturna: versão (head), arquivos com linhas mudadas e o diff unificado montado
   * a partir de cada arquivo. Arquivo sem `patch` (binário ou grande demais para o GitHub) entra só com o
   * cabeçalho. `totalChars` é o tamanho sem cortar: o filtro de tamanho da revisão decide com ele.
   */
  async getPullRequestDiff(repo: string, number: number): Promise<PullRequestDiff | null> {
    const pr = await this.getOrNull<{ head?: { sha?: string } }>(`/repos/${repo}/pulls/${number}`);
    const headSha = pr?.head?.sha;
    if (!headSha) return null;
    const files: PullRequestDiff["files"] = [];
    const parts: string[] = [];
    for (let page = 1; page <= MAX_FILE_PAGES; page++) {
      const { data } = await this.get<{ filename: string; previous_filename?: string; additions: number; deletions: number; patch?: string }[]>(
        `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      );
      for (const f of data) {
        files.push({ path: f.filename, additions: f.additions ?? 0, deletions: f.deletions ?? 0 });
        const from = f.previous_filename ?? f.filename;
        const header = `diff --git a/${from} b/${f.filename}\n--- a/${from}\n+++ b/${f.filename}\n`;
        parts.push(header + (f.patch !== undefined ? `${f.patch}\n` : "(diff não disponível: arquivo binário ou grande demais)\n"));
      }
      if (data.length < 100) break;
    }
    const patch = parts.join("");
    return { headSha, files, totalChars: patch.length, patch };
  }

  // ---------- Correção (etapa 10)

  /** O PR como está agora, para decidir se a correção pode rodar (aberto, mesma versão, sem fork). */
  async target(repo: string, number: number): Promise<FixTarget | null> {
    const pr = await this.getOrNull<any>(`/repos/${repo}/pulls/${number}`);
    if (!pr?.head?.sha) return null;
    return {
      state: pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : pr.draft ? "draft" : "open",
      headSha: pr.head.sha,
      headRepository: pr.head.repo?.full_name ?? "",
      repository: pr.base?.repo?.full_name ?? repo,
      branch: pr.head.ref,
      defaultBranch: pr.base?.repo?.default_branch ?? "main",
    };
  }

  /** Estado e versão de um PR (o original ou o rascunho), conferidos na hora da aprovação. */
  async pull(repo: string, number: number): Promise<PullHead | null> {
    const pr = await this.getOrNull<any>(`/repos/${repo}/pulls/${number}`);
    if (!pr?.head?.sha) return null;
    return { state: pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open", headSha: pr.head.sha };
  }

  /** Token de 1 h só deste repositório e só `contents: read`, para o ambiente isolado clonar o código. */
  async readToken(repo: string): Promise<string> {
    const name = repo.split("/")[1] ?? repo;
    const { data } = await this.app.request<{ token: string }>(`/app/installations/${this.installationId}/access_tokens`, async () => this.app.jwt(), {
      method: "POST",
      body: { repositories: [name], permissions: { contents: "read" } },
    });
    return data.token;
  }

  private send<T>(path: string, method: string, body: unknown) {
    return this.app.request<T>(path, () => this.app.installationToken(this.installationId), { method, body });
  }

  /** Conteúdo de um arquivo numa versão; null se não existe. */
  private async fileAt(repo: string, path: string, ref: string): Promise<string | null> {
    const data = await this.getOrNull<{ sha: string; content?: string; encoding?: string }>(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`);
    if (!data) return null;
    // Acima de 1 MB a API de conteúdo não manda o corpo: lê pelo blob.
    if (data.encoding === "base64" && data.content) return Buffer.from(data.content, "base64").toString("utf8");
    return this.readBlob(repo, data.sha);
  }

  /**
   * Rascunho da correção: aplica o diff (já conferido) sobre a versão analisada, num commit cujo pai é essa
   * versão, na branch `branch` (só do Echo), e abre o PR em rascunho apontando para a branch do PR original.
   * Diff que não bate com o código recusa tudo (PatchConflictError), sem branch nem PR.
   */
  async createFixDraft(input: { repo: string; base: string; baseSha: string; branch: string; title: string; body: string; patch: string }): Promise<{ number: number; headSha: string }> {
    const { repo } = input;
    const tree: { path: string; mode: string; type: "blob"; content: string }[] = [];
    for (const f of splitUnifiedDiff(input.patch)) {
      const original = f.status === "added" ? "" : await this.fileAt(repo, f.path, input.baseSha);
      if (original === null) throw new PatchConflictError(`${f.path} não existe na versão ${input.baseSha.slice(0, 7)}`);
      tree.push({ path: f.path, mode: "100644", type: "blob", content: applyFilePatch(original, f.hunks) });
    }
    if (!tree.length) throw new PatchConflictError("diff vazio");
    const { data: baseCommit } = await this.get<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${input.baseSha}`);
    const { data: newTree } = await this.send<{ sha: string }>(`/repos/${repo}/git/trees`, "POST", { base_tree: baseCommit.tree.sha, tree });
    const { data: commit } = await this.send<{ sha: string }>(`/repos/${repo}/git/commits`, "POST", { message: input.title, tree: newTree.sha, parents: [input.baseSha] });
    try {
      await this.send(`/repos/${repo}/git/refs`, "POST", { ref: `refs/heads/${input.branch}`, sha: commit.sha });
    } catch (err) {
      // A branch já existe (correção anterior recusada ou falha): é só do Echo, aponta para o commit novo.
      if (!(err instanceof GithubApiError && err.status === 422)) throw err;
      await this.send(`/repos/${repo}/git/refs/heads/${input.branch.split("/").map(encodeURIComponent).join("/")}`, "PATCH", { sha: commit.sha, force: true });
    }
    try {
      const { data: pr } = await this.send<{ number: number }>(`/repos/${repo}/pulls`, "POST", { title: input.title, body: input.body, head: input.branch, base: input.base, draft: true });
      return { number: pr.number, headSha: commit.sha };
    } catch (err) {
      if (!(err instanceof GithubApiError && err.status === 422)) throw err;
      const existing = await this.findPullRequestByBranch(repo, input.branch);
      if (!existing || existing.state === "closed" || existing.state === "merged") throw err;
      return { number: existing.number, headSha: commit.sha };
    }
  }

  /**
   * União aprovada pelo autor: leva exatamente a versão aprovada do rascunho para a branch do PR (merge do commit,
   * não do PR, porque o GitHub não une PR em rascunho; o rascunho aparece como unido em seguida).
   */
  async mergeFix(input: { repo: string; base: string; sha: string; message: string }): Promise<{ sha: string | null }> {
    const { data } = await this.send<{ sha?: string } | undefined>(`/repos/${input.repo}/merges`, "POST", { base: input.base, head: input.sha, commit_message: input.message });
    return { sha: data?.sha ?? null };
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

  async listFiles(repo: string): Promise<{ files: Map<string, string>; truncated: boolean }> {
    const files = new Map<string, string>();
    try {
      const { data } = await this.get<{ truncated: boolean; tree: { path: string; type: string; sha: string }[] }>(`/repos/${repo}/git/trees/HEAD?recursive=1`);
      for (const e of data.tree) if (e.type === "blob") files.set(e.path, e.sha);
      return { files, truncated: data.truncated };
    } catch (err) {
      // Repositório recém-criado, sem nenhum commit: 409 "Git Repository is empty".
      if (err instanceof GithubApiError && (err.status === 409 || err.status === 404)) return { files, truncated: false };
      throw err;
    }
  }

  async readBlob(repo: string, sha: string): Promise<string> {
    const { data } = await this.get<{ content: string; encoding: string }>(`/repos/${repo}/git/blobs/${sha}`);
    return data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf8") : data.content;
  }

  async editsSince(repo: string, path: string, syncedSha: string | null): Promise<PathEdits> {
    const { data } = await this.get<(CommitIdentity & { sha: string })[]>(`/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=${MIRROR_MAX_COMMITS + 1}`);
    const logins: string[] = [];
    for (const c of data) {
      // O commit em que o arquivo ficou igual ao que o Echo conhece é o ponto de sincronização: dali para trás já valeu.
      if (syncedSha !== null && (await this.blobAt(repo, path, c.sha)) === syncedSha) return { kind: "ok", logins };
      if (logins.length === MIRROR_MAX_COMMITS) return { kind: "historico_longo" };
      const login = trustedLogin(c);
      if (!login) return { kind: "nao_verificado" };
      logins.push(login);
    }
    // Sem ponto de sincronização na lista: só vale se a lista inteira coube (o arquivo nasceu nela).
    return data.length > MIRROR_MAX_COMMITS ? { kind: "historico_longo" } : { kind: "ok", logins };
  }

  /** Sha do blob do caminho num commit (null se o arquivo não existia nele). */
  private async blobAt(repo: string, path: string, ref: string): Promise<string | null> {
    const data = await this.getOrNull<{ sha: string }>(`/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`);
    return data?.sha ?? null;
  }

  async putFile(repo: string, path: string, content: string, message: string, previousSha?: string): Promise<{ sha: string }> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    try {
      const { data } = await this.app.request<{ content: { sha: string } }>(`/repos/${repo}/contents/${encoded}`, () => this.app.installationToken(this.installationId), {
        method: "PUT",
        body: { message, content: Buffer.from(content, "utf8").toString("base64"), ...(previousSha ? { sha: previousSha } : {}) },
      });
      return { sha: data.content.sha };
    } catch (err) {
      // 409: sha diferente do atual. 422: o arquivo já existe e não foi informado sha.
      if (err instanceof GithubApiError && (err.status === 409 || err.status === 422)) throw new FileChangedError(`${path} mudou no repositório`);
      throw err;
    }
  }

  async deleteFile(repo: string, path: string, sha: string, message: string): Promise<void> {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    try {
      await this.app.request(`/repos/${repo}/contents/${encoded}`, () => this.app.installationToken(this.installationId), { method: "DELETE", body: { message, sha } });
    } catch (err) {
      if (err instanceof GithubApiError && err.status === 404) return;
      if (err instanceof GithubApiError && (err.status === 409 || err.status === 422)) throw new FileChangedError(`${path} mudou no repositório`);
      throw err;
    }
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

  /**
   * PRs abertos em [from, to) com as revisões enviadas, para a referência dos Ganhos (90 dias antes do Echo,
   * medida uma vez). Só datas e logins: nem título, nem texto da revisão. Até `maxPrs` por repositório.
   */
  async listPullRequestHistory(repo: string, from: Date, to: Date, maxPrs = 300): Promise<PullRequestHistory[]> {
    const out: PullRequestHistory[] = [];
    for (let page = 1; page <= 30 && out.length < maxPrs; page++) {
      const { data } = await this.get<any[]>(`/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=100&page=${page}`);
      let older = false;
      for (const pr of data) {
        const openedAt = new Date(pr.created_at);
        if (openedAt.getTime() < from.getTime()) {
          older = true;
          break;
        }
        if (openedAt.getTime() >= to.getTime() || out.length >= maxPrs) continue;
        const reviews: PullRequestHistory["reviews"] = [];
        for (let rp = 1; rp <= 5; rp++) {
          const { data: rs } = await this.get<any[]>(`/repos/${repo}/pulls/${pr.number}/reviews?per_page=100&page=${rp}`);
          for (const r of rs) if (r.submitted_at && r.user?.login) reviews.push({ login: r.user.login, isBot: r.user.type === "Bot", at: new Date(r.submitted_at) });
          if (rs.length < 100) break;
        }
        out.push({ repository: repo, number: pr.number, authorLogin: pr.user?.login ?? undefined, openedAt, mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined, reviews });
      }
      if (older || data.length < 100) break;
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
