// Ganhos em Postgres. Toda consulta em withOrg com filtro explícito de org_id. Só datas, estados e ids: nenhum
// texto de pergunta, PR ou revisão sai daqui.
import { type Database, fixRuns, identities, installations, orgs, planItems, pullRequests, questions, redistributionPlans, reviews, teams, withOrg, workEvents } from "@echo/db";
import { GAINS_RULES, type GainsCoverage, type GainsPr, parseGainsBaseline } from "@echo/domain";
import { and, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { createGains, type GainsHistory, type GainsStore, type GainsView } from "./gains.ts";
import { createPgAgentData } from "./pg-data.ts";

export function createPgGainsStore(db: Database, orgId: string): GainsStore {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);

  return {
    async echoStart() {
      return run(async (tx) => {
        const [gh] = await tx
          .select({ at: sql<Date>`min(${installations.createdAt})`.mapWith((v) => (v ? new Date(v) : null)) })
          .from(installations)
          .where(and(eq(installations.orgId, orgId), eq(installations.kind, "github")));
        if (gh?.at) return gh.at;
        const [o] = await tx.select({ at: orgs.createdAt }).from(orgs).where(eq(orgs.id, orgId));
        if (!o) throw new Error("empresa não encontrada");
        return o.at;
      });
    },
    async baseline() {
      const [o] = await run((tx) => tx.select({ b: orgs.gainsBaseline }).from(orgs).where(eq(orgs.id, orgId)));
      return o?.b ?? null;
    },
    async saveBaselineOnce(b) {
      return run(async (tx) => {
        // Trava a linha da empresa: duas medições ao mesmo tempo não gravam duas vezes.
        const [o] = await tx.select({ b: orgs.gainsBaseline }).from(orgs).where(eq(orgs.id, orgId)).for("update");
        if (!o || parseGainsBaseline(o.b)) return false;
        await tx.update(orgs).set({ gainsBaseline: b }).where(eq(orgs.id, orgId));
        return true;
      });
    },
    async questions(since) {
      const rows = await run((tx) =>
        tx
          .select({ ownerId: questions.ownerId, state: questions.state, answeredAt: questions.answeredAt, ownerReturnsAt: questions.ownerReturnsAt, resolved: questions.resolved })
          .from(questions)
          .where(and(eq(questions.orgId, orgId), isNotNull(questions.ownerId), gte(questions.answeredAt, since))),
      );
      return rows.map((r) => ({ ownerId: r.ownerId ?? undefined, state: r.state, answeredAt: r.answeredAt ?? undefined, ownerReturnsAt: r.ownerReturnsAt ?? undefined, resolved: r.resolved }));
    },
    async pullRequests(since) {
      return run(async (tx) => {
        const prs = await tx
          .select({ id: pullRequests.id, repository: pullRequests.repository, number: pullRequests.number, authorId: pullRequests.authorId, openedAt: pullRequests.openedAt, mergedAt: pullRequests.mergedAt })
          .from(pullRequests)
          .where(and(eq(pullRequests.orgId, orgId), or(gte(pullRequests.openedAt, since), gte(pullRequests.mergedAt, since))));
        if (prs.length === 0) return [];
        const repos = [...new Set(prs.map((p) => p.repository))];
        const revs = await tx
          .select({ repository: workEvents.repository, number: workEvents.prNumber, personId: workEvents.personId, at: workEvents.occurredAt })
          .from(workEvents)
          .where(and(eq(workEvents.orgId, orgId), eq(workEvents.type, "review"), inArray(workEvents.repository, repos), gte(workEvents.occurredAt, since)));
        const analyses = await tx
          .select({ prId: reviews.prId, at: sql<Date>`min(${reviews.createdAt})`.mapWith((v) => new Date(v)) })
          .from(reviews)
          .where(and(eq(reviews.orgId, orgId), inArray(reviews.prId, prs.map((p) => p.id))))
          .groupBy(reviews.prId);
        const firstAnalysis = new Map(analyses.map((a) => [a.prId, a.at]));
        return prs.map(
          (p): GainsPr => ({
            authorId: p.authorId ?? undefined,
            openedAt: p.openedAt ?? undefined,
            mergedAt: p.mergedAt ?? undefined,
            reviews: revs.filter((r) => r.repository === p.repository && r.number === p.number).map((r) => ({ personId: r.personId ?? undefined, at: r.at })),
            firstAnalysisAt: firstAnalysis.get(p.id),
          }),
        );
      });
    },
    async fixes(since) {
      const rows = await run((tx) =>
        tx
          .select({ state: fixRuns.state, createdAt: fixRuns.createdAt, authorId: pullRequests.authorId })
          .from(fixRuns)
          .innerJoin(reviews, and(eq(reviews.id, fixRuns.reviewId), eq(reviews.orgId, orgId)))
          .innerJoin(pullRequests, and(eq(pullRequests.id, reviews.prId), eq(pullRequests.orgId, orgId)))
          .where(and(eq(fixRuns.orgId, orgId), gte(fixRuns.createdAt, since))),
      );
      return rows.map((r) => ({ authorId: r.authorId ?? undefined, state: r.state, createdAt: r.createdAt }));
    },
    async coverage(since) {
      return run(async (tx) => {
        const plans = await tx
          .select({ id: redistributionPlans.id, options: redistributionPlans.options, createdAt: redistributionPlans.createdAt, approvedAt: redistributionPlans.approvedAt })
          .from(redistributionPlans)
          .where(and(eq(redistributionPlans.orgId, orgId), gte(redistributionPlans.createdAt, since)));
        if (plans.length === 0) return [];
        const moved = await tx
          .select({ planId: planItems.planId, n: sql<number>`count(*)`.mapWith(Number) })
          .from(planItems)
          .where(and(eq(planItems.orgId, orgId), inArray(planItems.planId, plans.map((p) => p.id)), inArray(planItems.state, [...GAINS_RULES.coverageItem])))
          .groupBy(planItems.planId);
        const count = new Map(moved.map((m) => [m.planId, m.n]));
        // Quem se ausenta fica em `options.absentId` do plano (etapa 11).
        return plans.flatMap((p): GainsCoverage[] => {
          const absentId = (p.options as { absentId?: unknown } | null)?.absentId;
          if (typeof absentId !== "string") return [];
          return [{ absentId, itemsMoved: count.get(p.id) ?? 0, createdAt: p.createdAt, approvedAt: p.approvedAt ?? undefined }];
        });
      });
    },
    async teams() {
      return run((tx) => tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.orgId, orgId)));
    },
  };
}

/** O que o histórico precisa do GitHub (GithubCodeHost cumpre). */
export interface CodeHistorySource {
  listRepositories(): Promise<string[]>;
  listPullRequestHistory(repo: string, from: Date, to: Date): Promise<{ authorLogin?: string | undefined; openedAt: Date; mergedAt?: Date | undefined; reviews: { login: string; isBot: boolean; at: Date }[] }[]>;
}

/**
 * Histórico dos 90 dias direto do GitHub, com logins ligados às pessoas pelas contas cadastradas. Login sem
 * conta ligada e robôs ficam sem pessoa: não contam como revisão humana.
 */
export function createGithubGainsHistory(db: Database, orgId: string, host: CodeHistorySource): GainsHistory {
  return {
    async pullRequests(from, to) {
      const ids = await withOrg(db, orgId, (tx) =>
        tx.select({ personId: identities.personId, externalId: identities.externalId, login: identities.login }).from(identities).where(and(eq(identities.orgId, orgId), eq(identities.platform, "github"))),
      );
      const byLogin = new Map<string, string>();
      for (const i of ids) for (const l of [i.login, i.externalId]) if (l) byLogin.set(l.toLowerCase(), i.personId);
      const person = (login: string | undefined) => (login ? byLogin.get(login.toLowerCase()) : undefined);
      const out: GainsPr[] = [];
      for (const repo of await host.listRepositories()) {
        for (const pr of await host.listPullRequestHistory(repo, from, to)) {
          out.push({ authorId: person(pr.authorLogin), openedAt: pr.openedAt, mergedAt: pr.mergedAt, reviews: pr.reviews.map((r) => ({ personId: r.isBot ? undefined : person(r.login), at: r.at })) });
        }
      }
      return out;
    },
  };
}

/**
 * Totais da tela Ganhos direto do Postgres, sem o resto do servidor dos agentes (leve para o painel).
 * Leitura de tela: não é execução de agente e não grava em agent_runs.
 */
export function readGains(db: Database, orgId: string, now?: Date): Promise<GainsView> {
  return createGains({
    data: (o) => createPgAgentData(db, o),
    store: (o) => createPgGainsStore(db, o),
    recorder: { record: async () => {} },
    ...(now ? { clock: { now: () => now } } : {}),
  }).get(orgId);
}
