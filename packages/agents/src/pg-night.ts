// Revisões e planos da manhã em Postgres. Toda consulta em withOrg com filtro explícito de org_id.
import { type Database, identities, morningPlans, pullRequests, questions, reviews, withOrg } from "@echo/db";
import { type FindingSeverity, type PlanFinding, type PlanItem, type PlanQuestion, severityRank } from "@echo/domain";
import { and, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import type { PlanStore } from "./morning-plan.ts";
import type { Finding, ReviewStore, StoredReview } from "./night-review.ts";

const IDENT = /(?<![\p{L}\d-])([a-z][a-z0-9]*-\d+(?:-[a-z0-9]+)*)(?![\p{L}\d-])/iu;

export function createPgReviewStore(db: Database, orgId: string): ReviewStore {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);
  const toStored = (r: typeof reviews.$inferSelect, pr: { repository: string; number: number }): StoredReview => ({
    id: r.id,
    prId: r.prId,
    pr: { repository: pr.repository, number: pr.number },
    headSha: r.headSha,
    state: r.state,
    ...(r.batchId ? { batchId: r.batchId } : {}),
    ...(r.model ? { model: r.model } : {}),
    files: r.files,
  });
  const select = (extra: ReturnType<typeof and>) =>
    run((tx) =>
      tx
        .select({ r: reviews, repository: pullRequests.repository, number: pullRequests.number })
        .from(reviews)
        .innerJoin(pullRequests, and(eq(pullRequests.id, reviews.prId), eq(pullRequests.orgId, orgId)))
        .where(and(eq(reviews.orgId, orgId), extra)),
    );

  return {
    async forPr(prId) {
      return (await select(and(eq(reviews.prId, prId)))).map((x) => toStored(x.r, x));
    },
    async create(input) {
      const [row] = await run((tx) =>
        tx
          .insert(reviews)
          .values({ orgId, prId: input.prId, headSha: input.headSha, model: input.model ?? null, state: input.state, files: input.files })
          .onConflictDoNothing()
          .returning({ id: reviews.id }),
      );
      return row ?? null;
    },
    async markBatched(ids, batchId) {
      if (ids.length === 0) return;
      await run((tx) => tx.update(reviews).set({ state: "batched", batchId }).where(and(eq(reviews.orgId, orgId), inArray(reviews.id, ids), eq(reviews.state, "queued"))));
    },
    async batched() {
      return (await select(and(eq(reviews.state, "batched")))).map((x) => toStored(x.r, x));
    },
    async finish(id, result) {
      const rows = await run((tx) =>
        tx
          .update(reviews)
          .set({ state: result.state, findings: result.findings, ...(result.costUsd !== undefined ? { costUsd: result.costUsd.toFixed(4) } : {}) })
          .where(and(eq(reviews.orgId, orgId), eq(reviews.id, id), eq(reviews.state, "batched")))
          .returning({ id: reviews.id }),
      );
      return rows.length > 0;
    },
  };
}

export function createPgPlanStore(db: Database, orgId: string): PlanStore {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);
  return {
    async questionsForOwner(personId, since) {
      const rows = await run((tx) =>
        tx
          .select()
          .from(questions)
          .where(
            and(
              eq(questions.orgId, orgId),
              eq(questions.ownerId, personId),
              eq(questions.needsOwner, true),
              or(isNull(questions.resolved), eq(questions.resolved, false)),
              ne(questions.state, "silent"),
              gte(questions.createdAt, since),
            ),
          ),
      );
      const now = Date.now();
      return rows.flatMap((q): PlanQuestion[] => {
        if (!q.askerId) return [];
        // O texto só é lido enquanto não venceu, e só para tirar o assunto (branch ou tarefa).
        const text = q.text && (!q.textExpiresAt || q.textExpiresAt.getTime() > now) ? q.text : "";
        const subject = IDENT.exec(text)?.[1];
        return [{ id: q.id, askerId: q.askerId, createdAt: q.createdAt, ...(subject ? { subject } : {}) }];
      });
    },
    async findingsForAuthor(personId, since) {
      const rows = await run((tx) =>
        tx
          .select({ id: reviews.id, findings: reviews.findings, repository: pullRequests.repository, number: pullRequests.number })
          .from(reviews)
          .innerJoin(pullRequests, and(eq(pullRequests.id, reviews.prId), eq(pullRequests.orgId, orgId)))
          .where(and(eq(reviews.orgId, orgId), eq(reviews.state, "reviewed"), eq(pullRequests.authorId, personId), eq(pullRequests.state, "open"), gte(reviews.createdAt, since))),
      );
      return rows.flatMap((r): PlanFinding[] => {
        const list = (Array.isArray(r.findings) ? r.findings : []) as Finding[];
        if (list.length === 0) return [];
        const severity = list.map((f) => f.gravidade).sort((a, b) => severityRank(a) - severityRank(b))[0] as FindingSeverity;
        return [{ reviewId: r.id, pr: { repository: r.repository, number: r.number }, severity, count: list.length }];
      });
    },
    async get(personId, date) {
      const [r] = await run((tx) => tx.select().from(morningPlans).where(and(eq(morningPlans.orgId, orgId), eq(morningPlans.personId, personId), eq(morningPlans.date, date))));
      return r ? { personId: r.personId, date: r.date, items: r.items as PlanItem[] } : null;
    },
    async create(plan) {
      const rows = await run((tx) => tx.insert(morningPlans).values({ orgId, personId: plan.personId, date: plan.date, items: plan.items, state: "sent" }).onConflictDoNothing().returning({ id: morningPlans.id }));
      return rows.length > 0;
    },
    async updateItems(personId, date, items) {
      const rows = await run((tx) =>
        tx.update(morningPlans).set({ items, state: "edited" }).where(and(eq(morningPlans.orgId, orgId), eq(morningPlans.personId, personId), eq(morningPlans.date, date))).returning({ id: morningPlans.id }),
      );
      return rows.length > 0;
    },
    async slackUserOf(personId) {
      const [r] = await run((tx) => tx.select({ ext: identities.externalId }).from(identities).where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack"), eq(identities.personId, personId))).limit(1));
      return r?.ext ?? null;
    },
  };
}
