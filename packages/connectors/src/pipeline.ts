// CI/CD para as respostas do agente (etapa 19): "os testes passaram?" e "já está em produção?".
// Base no espelho local (avisos de check_suite e da Vercel); com o GitHub ligado, os checks são lidos ao vivo.
import { deployments, pullRequests, withOrg, type Database } from "@echo/db";
import { and, desc, eq, gte, or } from "drizzle-orm";
import type { ChecksState } from "./normalized.ts";

export interface LiveChecks {
  getChecks(repo: string, ref: string): Promise<{ state: ChecksState | "none"; total: number; failed: string[]; running: number; url: string }>;
}

export interface CiStatus {
  repository: string;
  number: number;
  headSha: string | null;
  state: ChecksState | "none" | "unknown";
  failed: string[];
  url: string | null;
  /** true quando veio da consulta ao vivo; false = último aviso recebido (com a data). */
  live: boolean;
  checkedAt: Date | null;
}

/** Estado dos checks do último commit do PR. Sem o PR no espelho, null. */
export async function ciStatus(db: Database, orgId: string, repo: string, number: number, live?: LiveChecks): Promise<CiStatus | null> {
  const [pr] = await withOrg(db, orgId, (tx) =>
    tx.select().from(pullRequests).where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.repository, repo), eq(pullRequests.number, number))),
  );
  if (!pr) return null;
  const base = { repository: repo, number, headSha: pr.headSha };
  if (live && pr.headSha) {
    try {
      const c = await live.getChecks(repo, pr.headSha);
      return { ...base, state: c.state, failed: c.failed, url: c.url, live: true, checkedAt: new Date() };
    } catch {
      // GitHub fora: vale o último aviso, e a resposta avisa que não checou ao vivo.
    }
  }
  return { ...base, state: (pr.checksState as ChecksState | null) ?? "unknown", failed: [], url: pr.checksUrl, live: false, checkedAt: pr.checksUpdatedAt };
}

export interface DeployStatus {
  repository: string;
  number: number;
  merged: boolean;
  /** Preview do último commit do PR, se houver. */
  preview: { state: string; url: string | null; at: Date } | null;
  /** Produção: deploy pronto da branch de produção depois do merge. */
  production: { state: string; url: string | null; at: Date } | null;
  inProduction: boolean;
}

/**
 * "Já foi para produção?": o PR precisa estar unido e haver um deploy de produção pronto
 * depois do merge (a Vercel publica o commit de merge, não o último commit do PR).
 */
export async function deployStatus(db: Database, orgId: string, repo: string, number: number): Promise<DeployStatus | null> {
  return withOrg(db, orgId, async (tx) => {
    const [pr] = await tx.select().from(pullRequests).where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.repository, repo), eq(pullRequests.number, number)));
    if (!pr) return null;
    const [preview] = await tx
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.orgId, orgId),
          eq(deployments.environment, "preview"),
          or(pr.headSha ? eq(deployments.sha, pr.headSha) : undefined, and(eq(deployments.repository, repo), eq(deployments.branch, pr.branch))),
        ),
      )
      .orderBy(desc(deployments.occurredAt))
      .limit(1);
    const [production] = pr.mergedAt
      ? await tx
          .select()
          .from(deployments)
          .where(and(eq(deployments.orgId, orgId), eq(deployments.environment, "production"), eq(deployments.repository, repo), gte(deployments.occurredAt, pr.mergedAt)))
          .orderBy(desc(deployments.occurredAt))
          .limit(1)
      : [];
    const pick = (d?: typeof deployments.$inferSelect) => (d ? { state: d.state, url: d.url, at: d.occurredAt } : null);
    return {
      repository: repo,
      number,
      merged: pr.state === "merged",
      preview: pick(preview),
      production: pick(production),
      inProduction: pr.state === "merged" && production?.state === "ready",
    };
  });
}
