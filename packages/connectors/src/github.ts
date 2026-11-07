import { createHash } from "node:crypto";
import { taskKeyFrom, type ExternalActor, type ExternalPullRequest, type NormalizedEvent } from "./normalized.ts";

// Formatos mínimos dos webhooks do GitHub que usamos (o resto do corpo é ignorado).
interface GhUser { login: string; id: number }
interface GhRepo { full_name: string }
interface GhPr {
  number: number; title: string; state: "open" | "closed"; draft?: boolean; merged?: boolean;
  merged_at?: string | null; created_at: string; updated_at?: string; closed_at?: string | null; head: { ref: string; sha: string }; user: GhUser;
  requested_reviewers?: GhUser[];
}

/** Commit no formato do aviso de push (a reconciliação converte para o mesmo formato). */
export interface GhCommit {
  id: string;
  message: string;
  timestamp: string;
  author?: { username?: string; name?: string };
}

/** Commit vira fato do trabalho. Autor só quando o GitHub ligou o commit a uma conta: nunca adivinhar pelo nome. */
export function commitEvent(repository: string, branch: string | undefined, c: GhCommit): NormalizedEvent {
  return {
    kind: "work_event",
    event: {
      type: "commit",
      actor: c.author?.username ? { platform: "github", login: c.author.username } : undefined,
      repository,
      branch,
      taskKey: taskKeyFrom(branch, c.message),
      occurredAt: new Date(c.timestamp),
      source: "github",
      sourceRef: `commit:${c.id}`,
      data: { coauthors: parseCoauthors(c.message ?? "") },
    },
  };
}

const actor = (u?: GhUser | null): ExternalActor | undefined => (u ? { platform: "github", externalId: String(u.id), login: u.login } : undefined);

/** "Co-authored-by: Nome <email>" → hash do e-mail (o e-mail em si não é guardado) e login quando é noreply. */
export function parseCoauthors(message: string): { name: string; emailHash: string; login?: string }[] {
  const out: { name: string; emailHash: string; login?: string }[] = [];
  for (const m of message.matchAll(/^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)) {
    const email = m[2]!.trim().toLowerCase();
    const noreply = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
    out.push({ name: m[1]!, emailHash: createHash("sha256").update(email).digest("hex"), ...(noreply ? { login: noreply[1]! } : {}) });
  }
  return out;
}

function prState(pr: GhPr): ExternalPullRequest["state"] {
  if (pr.merged || pr.merged_at) return "merged";
  if (pr.state === "closed") return "closed";
  return pr.draft ? "draft" : "open";
}

function toPr(repo: GhRepo, pr: GhPr): ExternalPullRequest {
  return {
    repository: repo.full_name,
    number: pr.number,
    title: pr.title,
    author: actor(pr.user),
    state: prState(pr),
    branch: pr.head.ref,
    headSha: pr.head.sha,
    taskKey: taskKeyFrom(pr.head.ref, pr.title),
    reviewers: (pr.requested_reviewers ?? []).map((u) => actor(u)!),
    openedAt: new Date(pr.created_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : undefined,
    updatedAt: new Date(pr.updated_at ?? pr.created_at),
  };
}

/** Conclusão de uma suíte (ou de um check) → estado resumido. */
export function checksStateOf(conclusion: string | null | undefined): "success" | "failure" | "pending" | "neutral" {
  switch (conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "cancelled":
    case "action_required":
    case "startup_failure":
      return "failure";
    case "neutral":
    case "skipped":
    case "stale":
      return "neutral";
    default:
      return "pending";
  }
}

/** Instalação do GitHub App que enviou o aviso: aponta para a empresa em installation_routes. */
export const githubRouteKey = (body: any): string | undefined => (body?.installation?.id ? String(body.installation.id) : undefined);

/** Normaliza um webhook do GitHub (cabeçalho X-GitHub-Event) em eventos do Echo. */
export function normalizeGithub(event: string, body: any): NormalizedEvent[] {
  const repo: GhRepo | undefined = body?.repository;
  if (!repo) return [{ kind: "ignored", reason: `github ${event} sem repositório` }];

  if (event === "push") {
    const ref: string = body.ref ?? "";
    if (!ref.startsWith("refs/heads/") || body.deleted) return [{ kind: "ignored", reason: "push que não é de branch" }];
    const branch = ref.slice("refs/heads/".length);
    return (body.commits ?? []).map((c: GhCommit) => commitEvent(repo.full_name, branch, c));
  }

  if (event === "pull_request") {
    const pr: GhPr = body.pull_request;
    const out: NormalizedEvent[] = [{ kind: "pr_upsert", pr: toPr(repo, pr) }];
    const base = { actor: actor(pr.user), repository: repo.full_name, branch: pr.head.ref, prNumber: pr.number, taskKey: taskKeyFrom(pr.head.ref, pr.title), source: "github" as const };
    if (body.action === "opened" || body.action === "reopened") {
      out.push({ kind: "work_event", event: { ...base, type: "pr_opened", occurredAt: new Date(pr.created_at), sourceRef: `pr:${repo.full_name}#${pr.number}:opened:${pr.head.sha}` } });
    } else if (body.action === "closed") {
      const merged = Boolean(pr.merged);
      out.push({
        kind: "work_event",
        event: { ...base, type: merged ? "pr_merged" : "pr_closed", occurredAt: new Date(pr.merged_at ?? pr.closed_at ?? pr.updated_at ?? pr.created_at), sourceRef: `pr:${repo.full_name}#${pr.number}:${merged ? "merged" : "closed"}` },
      });
    }
    return out;
  }

  if (event === "pull_request_review" && body.action === "submitted") {
    const pr: GhPr = body.pull_request;
    const r = body.review;
    return [{
      kind: "work_event",
      event: {
        type: "review", actor: actor(r.user), repository: repo.full_name, branch: pr.head.ref, prNumber: pr.number,
        taskKey: taskKeyFrom(pr.head.ref, pr.title), occurredAt: new Date(r.submitted_at), source: "github",
        sourceRef: `review:${r.id}`, data: { state: String(r.state).toLowerCase(), prAuthorLogin: pr.user.login },
      },
    }];
  }

  if (event === "pull_request_review_comment" && body.action === "created") {
    const pr: GhPr = body.pull_request;
    const c = body.comment;
    return [{
      kind: "work_event",
      event: {
        type: "review_comment", actor: actor(c.user), repository: repo.full_name, branch: pr.head.ref, prNumber: pr.number,
        occurredAt: new Date(c.created_at), source: "github", sourceRef: `review_comment:${c.id}`,
        // Só a referência: o texto do comentário é dado e não é guardado aqui.
        data: { path: c.path, line: c.line ?? null, prAuthorLogin: pr.user.login },
      },
    }];
  }

  if (event === "check_suite" && body.action === "completed") {
    const cs = body.check_suite;
    const prNumbers: number[] = (cs?.pull_requests ?? []).map((p: { number: number }) => p.number);
    if (!cs?.head_sha || prNumbers.length === 0) return [{ kind: "ignored", reason: "check_suite sem PR" }];
    return [{
      kind: "checks",
      repository: repo.full_name,
      headSha: cs.head_sha,
      prNumbers,
      state: checksStateOf(cs.conclusion),
      url: `https://github.com/${repo.full_name}/commit/${cs.head_sha}/checks`,
      at: new Date(cs.updated_at ?? Date.now()),
    }];
  }

  return [{ kind: "ignored", reason: `github ${event}${body.action ? `.${body.action}` : ""} não usado` }];
}
