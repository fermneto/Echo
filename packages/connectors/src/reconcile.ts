// Reconciliação (F1): cobre o que os avisos perderam. O GitHub não reenvia sozinho e qualquer
// plataforma pode falhar; aqui o Echo pergunta o estado atual e grava pelo mesmo ingest dos avisos.
// Idempotente: rodar duas vezes não duplica nada (mesmas chaves únicas dos avisos).
import { pullRequests, withOrg, type Database } from "@echo/db";
import { and, eq, inArray } from "drizzle-orm";
import { commitEvent, type GhCommit } from "./github.ts";
import type { CodeHost, IssueTracker } from "./index.ts";
import { ingest } from "./ingest.ts";
import type { ExternalTask, NormalizedEvent } from "./normalized.ts";

const DAY = 24 * 60 * 60_000;
/** Importação: commits e tarefas encerradas dos últimos 7 dias. */
export const BACKFILL_MS = 7 * DAY;
/** Consulta ao vivo de detalhes (arquivos) por repositório e rodada, para poupar o limite do GitHub. */
export const MAX_DETAILS_PER_REPO = 10;

export interface GithubReconciler extends CodeHost {
  listRepositories(): Promise<string[]>;
  listCommitsSince(repo: string, since: Date): Promise<GhCommit[]>;
}

export interface LinearReconciler extends IssueTracker {
  listClosedTasksSince(since: Date): Promise<{ tasks: ExternalTask[]; truncated: boolean }>;
}

export interface GithubReconcileResult {
  repositories: number;
  commits: number;
  openPrs: number;
  detailed: number;
  closedSinceLastRun: number;
  errors: string[];
}

/** Tarefa vira espelho; concluída também vira o fato task_done (mesma chave do aviso). */
function taskEvents(t: ExternalTask): NormalizedEvent[] {
  const out: NormalizedEvent[] = [{ kind: "task_upsert", task: t }];
  if (t.state === "done" && t.completedAt) {
    out.push({
      kind: "work_event",
      event: { type: "task_done", actor: t.assignee, taskKey: t.key, occurredAt: t.completedAt, source: "linear", sourceRef: `task_done:${t.linearId}` },
    });
  }
  return out;
}

export async function reconcileLinear(db: Database, orgId: string, linear: LinearReconciler, now: Date): Promise<{ open: number; closed: number; truncated: boolean }> {
  const [open, closed] = await Promise.all([linear.listOpenTasks(), linear.listClosedTasksSince(new Date(now.getTime() - BACKFILL_MS))]);
  await ingest(db, orgId, [...open.tasks, ...closed.tasks].flatMap(taskEvents));
  return { open: open.tasks.length, closed: closed.tasks.length, truncated: open.truncated || closed.truncated };
}

/**
 * GitHub, por repositório da instalação: commits dos últimos 7 dias, PRs abertos, arquivos dos PRs
 * que mudaram (com teto) e o estado final dos PRs que estavam abertos aqui e saíram da lista.
 * Falha num repositório não impede os outros; o erro volta no resultado.
 */
export async function reconcileGithub(
  db: Database,
  orgId: string,
  gh: GithubReconciler,
  now: Date,
  opts: { brainsRepository?: string | undefined } = {},
): Promise<GithubReconcileResult> {
  const res: GithubReconcileResult = { repositories: 0, commits: 0, openPrs: 0, detailed: 0, closedSinceLastRun: 0, errors: [] };
  const since = new Date(now.getTime() - BACKFILL_MS);
  const brains = opts.brainsRepository?.toLowerCase();
  const repos = (await gh.listRepositories()).filter((r) => r.toLowerCase() !== brains);
  res.repositories = repos.length;

  for (const repo of repos) {
    try {
      const [commits, open] = await Promise.all([gh.listCommitsSince(repo, since), gh.listOpenPullRequests(repo)]);
      res.commits += commits.length;
      res.openPrs += open.length;

      // O que já sabemos deste repositório, para decidir onde vale gastar consulta ao vivo.
      const known = await withOrg(db, orgId, (tx) =>
        tx
          .select({ number: pullRequests.number, state: pullRequests.state, files: pullRequests.files, externalUpdatedAt: pullRequests.externalUpdatedAt })
          .from(pullRequests)
          .where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.repository, repo))),
      );
      const byNumber = new Map(known.map((k) => [k.number, k]));
      const openNumbers = new Set(open.map((p) => p.number));

      // Commits sem branch (a listagem vem da branch padrão); a chave commit:<sha> é a mesma do aviso.
      const events: NormalizedEvent[] = commits.map((c) => commitEvent(repo, undefined, c));
      events.push(...open.map((pr) => ({ kind: "pr_upsert" as const, pr })));
      await ingest(db, orgId, events);

      // Arquivos só de quem mudou ou ainda não tem, até o teto por rodada.
      const needDetail = open.filter((pr) => {
        const k = byNumber.get(pr.number);
        return !k || k.files.length === 0 || !k.externalUpdatedAt || k.externalUpdatedAt < pr.updatedAt;
      });
      // PRs que estavam abertos aqui e não vieram na lista: foram unidos ou fechados sem o aviso chegar.
      const vanished = known.filter((k) => (k.state === "open" || k.state === "draft") && !openNumbers.has(k.number)).map((k) => k.number);
      const live: NormalizedEvent[] = [];
      for (const number of [...vanished, ...needDetail.map((p) => p.number)].slice(0, MAX_DETAILS_PER_REPO)) {
        try {
          const pr = await gh.getPullRequest(repo, number);
          if (!pr) continue;
          live.push({ kind: "pr_upsert", pr });
          if (vanished.includes(number)) {
            res.closedSinceLastRun++;
            if (pr.state === "merged" && pr.mergedAt) {
              live.push({
                kind: "work_event",
                event: { type: "pr_merged", actor: pr.author, repository: repo, branch: pr.branch, prNumber: pr.number, taskKey: pr.taskKey, occurredAt: pr.mergedAt, source: "github", sourceRef: `pr:${repo}#${pr.number}:merged` },
              });
            }
          } else {
            res.detailed++;
          }
        } catch (err) {
          // Falhar no detalhe só adia para a próxima rodada.
          res.errors.push(`${repo}#${number}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (live.length) await ingest(db, orgId, live);
    } catch (err) {
      res.errors.push(`${repo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
}

/** PRs abertos de uma empresa por repositório (para o painel e testes). */
export async function openPullRequestNumbers(db: Database, orgId: string, repo: string): Promise<number[]> {
  const rows = await withOrg(db, orgId, (tx) =>
    tx
      .select({ number: pullRequests.number })
      .from(pullRequests)
      .where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.repository, repo), inArray(pullRequests.state, ["open", "draft"]))),
  );
  return rows.map((r) => r.number).sort((a, b) => a - b);
}
