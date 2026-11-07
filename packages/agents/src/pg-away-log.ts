// O que o agente de uma pessoa fez enquanto ela estava fora, para o Início do painel. Só leitura, sem modelo.
// Toda consulta em withOrg com filtro explícito de org_id.
import { type Database, fixRuns, morningPlans, people, pullRequests, questions, reviews, withOrg } from "@echo/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

export interface AwayLogQuestion {
  id: string;
  askerName: string | null;
  /** Texto da pergunta, só enquanto não expirou (o mesmo prazo do Slack). */
  text: string | null;
  answer: string | null;
  needsOwner: boolean;
  sources: { label: string; ref: string }[];
  at: Date;
}

export interface AwayLogFix {
  id: string;
  prNumber: number;
  prTitle: string;
  state: string;
  at: Date;
}

export interface AwayLogPlan {
  date: string;
  items: number;
  at: Date;
}

export interface AwayLog {
  questions: AwayLogQuestion[];
  fixes: AwayLogFix[];
  plan: AwayLogPlan | null;
}

/** Correções que chegaram a ficar prontas para a pessoa aprovar. */
const FIX_DONE = ["ready", "approved", "applied"];

export async function readAwayLog(db: Database, input: { orgId: string; personId: string; since: Date; now: Date; limit?: number }): Promise<AwayLog> {
  const { orgId, personId, since, now } = input;
  const limit = input.limit ?? 20;
  return withOrg(db, orgId, async (tx) => {
    const qs = await tx
      .select({ q: questions, askerName: people.name })
      .from(questions)
      .leftJoin(people, eq(people.id, questions.askerId))
      .where(and(eq(questions.orgId, orgId), eq(questions.ownerId, personId), eq(questions.state, "answered"), gte(questions.answeredAt, since)))
      .orderBy(desc(questions.answeredAt))
      .limit(limit);

    const fixes = await tx
      .select({ id: fixRuns.id, state: fixRuns.state, at: fixRuns.createdAt, prNumber: pullRequests.number, prTitle: pullRequests.title })
      .from(fixRuns)
      .innerJoin(reviews, eq(reviews.id, fixRuns.reviewId))
      .innerJoin(pullRequests, eq(pullRequests.id, reviews.prId))
      .where(and(eq(fixRuns.orgId, orgId), eq(pullRequests.authorId, personId), inArray(fixRuns.state, FIX_DONE), gte(fixRuns.createdAt, since)))
      .orderBy(desc(fixRuns.createdAt))
      .limit(limit);

    const [plan] = await tx
      .select({ date: morningPlans.date, items: morningPlans.items, at: morningPlans.createdAt })
      .from(morningPlans)
      .where(and(eq(morningPlans.orgId, orgId), eq(morningPlans.personId, personId), gte(morningPlans.createdAt, since)))
      .orderBy(desc(morningPlans.createdAt))
      .limit(1);

    return {
      questions: qs.map(({ q, askerName }) => ({
        id: q.id,
        askerName,
        text: q.text && (!q.textExpiresAt || q.textExpiresAt.getTime() > now.getTime()) ? q.text : null,
        answer: q.answer,
        needsOwner: q.needsOwner,
        sources: q.sources,
        at: q.answeredAt ?? q.createdAt,
      })),
      fixes,
      plan: plan ? { date: plan.date, items: Array.isArray(plan.items) ? plan.items.length : 0, at: plan.at } : null,
    };
  });
}
