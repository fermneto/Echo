// Correções em Postgres. Toda consulta em withOrg com filtro explícito de org_id; cada mudança de estado só
// sai do estado esperado (a mesma correção nunca avança duas vezes).
import { type Database, fixRuns, outboxActions, people, pullRequests, reviews, withOrg } from "@echo/db";
import { cleanAgentText, type FixSkipReason, type PlanFix } from "@echo/domain";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { FixCandidate, FixState, FixStore, FixTestResult, StoredFix } from "./fix.ts";
import type { Finding } from "./night-review.ts";

const OPEN_STATES: FixState[] = ["running", "draft_queued", "ready", "approved"];
const TESTS = new Set<FixTestResult>(["passou", "falhou", "nao_rodou"]);

export function createPgFixStore(db: Database, orgId: string): FixStore & { fixesForAuthor(personId: string): Promise<PlanFix[]> } {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);

  const candidateRows = (extra: ReturnType<typeof and>) =>
    run((tx) =>
      tx
        .select({ r: reviews, p: pullRequests })
        .from(reviews)
        .innerJoin(pullRequests, and(eq(pullRequests.id, reviews.prId), eq(pullRequests.orgId, orgId)))
        .where(
          and(
            eq(reviews.orgId, orgId),
            eq(reviews.state, "reviewed"),
            sql`not exists (select 1 from ${fixRuns} where ${fixRuns.orgId} = ${orgId} and ${fixRuns.reviewId} = ${reviews.id})`,
            extra,
          ),
        ),
    );
  const toCandidate = ({ r, p }: { r: typeof reviews.$inferSelect; p: typeof pullRequests.$inferSelect }): FixCandidate => ({
    reviewId: r.id,
    prId: p.id,
    pr: { repository: p.repository, number: p.number, title: p.title, branch: p.branch, ...(p.authorId ? { authorId: p.authorId } : {}) },
    headSha: r.headSha,
    files: r.files,
    findings: (r.findings as Finding[]) ?? [],
  });

  const fixRows = (extra: ReturnType<typeof and>) =>
    run((tx) =>
      tx
        .select({ f: fixRuns, p: pullRequests })
        .from(fixRuns)
        .innerJoin(reviews, and(eq(reviews.id, fixRuns.reviewId), eq(reviews.orgId, orgId)))
        .innerJoin(pullRequests, and(eq(pullRequests.id, reviews.prId), eq(pullRequests.orgId, orgId)))
        .where(and(eq(fixRuns.orgId, orgId), extra)),
    );
  const toStored = ({ f, p }: { f: typeof fixRuns.$inferSelect; p: typeof pullRequests.$inferSelect }): StoredFix => ({
    id: f.id,
    reviewId: f.reviewId,
    pr: { repository: p.repository, number: p.number, branch: p.branch, ...(p.authorId ? { authorId: p.authorId } : {}) },
    state: f.state as FixState,
    ...(f.baseSha ? { baseSha: f.baseSha } : {}),
    ...(f.draftPrNumber !== null ? { draftPrNumber: f.draftPrNumber } : {}),
    ...(f.draftHeadSha ? { draftHeadSha: f.draftHeadSha } : {}),
    files: f.files,
    ...(f.testsReported && TESTS.has(f.testsReported as FixTestResult) ? { tests: f.testsReported as FixTestResult } : {}),
    ...(f.costUsd !== null ? { costUsd: Number(f.costUsd) } : {}),
  });

  /** Muda o estado da correção (só a partir de `from`) e, se mudou, o da revisão (só a partir de `reviewFrom`). */
  const move = (id: string, from: FixState | FixState[], set: Partial<typeof fixRuns.$inferInsert>, review?: { to: string; from: string[] }) =>
    run(async (tx) => {
      const [row] = await tx
        .update(fixRuns)
        .set(set)
        .where(and(eq(fixRuns.orgId, orgId), eq(fixRuns.id, id), inArray(fixRuns.state, Array.isArray(from) ? from : [from])))
        .returning({ reviewId: fixRuns.reviewId });
      if (!row) return false;
      if (review) await tx.update(reviews).set({ state: review.to }).where(and(eq(reviews.orgId, orgId), eq(reviews.id, row.reviewId), inArray(reviews.state, review.from)));
      return true;
    });

  return {
    async candidates() {
      return (await candidateRows(undefined)).map(toCandidate);
    },
    async candidate(reviewId) {
      const [row] = await candidateRows(eq(reviews.id, reviewId));
      return row ? toCandidate(row) : null;
    },
    async openFixForPr(prId) {
      const rows = await run((tx) =>
        tx
          .select({ id: fixRuns.id })
          .from(fixRuns)
          .innerJoin(reviews, and(eq(reviews.id, fixRuns.reviewId), eq(reviews.orgId, orgId)))
          .where(and(eq(fixRuns.orgId, orgId), eq(reviews.prId, prId), inArray(fixRuns.state, OPEN_STATES)))
          .limit(1),
      );
      return rows.length > 0;
    },
    async personSpentUsdSince(personId, since) {
      const [row] = await run((tx) =>
        tx
          .select({ total: sql<string | null>`sum(${fixRuns.costUsd})` })
          .from(fixRuns)
          .innerJoin(reviews, and(eq(reviews.id, fixRuns.reviewId), eq(reviews.orgId, orgId)))
          .innerJoin(pullRequests, and(eq(pullRequests.id, reviews.prId), eq(pullRequests.orgId, orgId)))
          .where(and(eq(fixRuns.orgId, orgId), eq(pullRequests.authorId, personId), gte(fixRuns.createdAt, since))),
      );
      return Number(row?.total ?? 0);
    },
    async skip(reviewId, reason: FixSkipReason) {
      const rows = await run((tx) => tx.insert(fixRuns).values({ orgId, reviewId, state: "skipped", error: reason }).onConflictDoNothing().returning({ id: fixRuns.id }));
      return rows.length > 0;
    },
    async start(reviewId, input) {
      return run(async (tx) => {
        const [row] = await tx
          .insert(fixRuns)
          .values({ orgId, reviewId, state: "running", baseSha: input.baseSha, branch: input.branch, findings: input.findings })
          .onConflictDoNothing()
          .returning({ id: fixRuns.id });
        if (!row) return null;
        await tx.update(reviews).set({ state: "fix_queued" }).where(and(eq(reviews.orgId, orgId), eq(reviews.id, reviewId), eq(reviews.state, "reviewed")));
        return row;
      });
    },
    async finish(id, result) {
      return move(
        id,
        "running",
        {
          state: result.state,
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          ...(result.files ? { files: result.files } : {}),
          ...(result.tests ? { testsReported: result.tests } : {}),
          ...(result.costUsd !== undefined ? { costUsd: result.costUsd.toFixed(4) } : {}),
          ...(result.error ? { error: result.error.slice(0, 2000) } : {}),
        },
        result.state === "draft_queued" ? undefined : { to: "reviewed", from: ["fix_queued"] },
      );
    },
    async get(id) {
      const [row] = await fixRows(eq(fixRuns.id, id));
      return row ? toStored(row) : null;
    },
    async inState(state) {
      return (await fixRows(eq(fixRuns.state, state))).map(toStored);
    },
    async outboxResult(idempotencyKey) {
      const [row] = await run((tx) =>
        tx
          .select({ state: outboxActions.state, result: outboxActions.result, error: outboxActions.error })
          .from(outboxActions)
          .where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.idempotencyKey, idempotencyKey))),
      );
      return row ? { state: row.state, result: row.result, ...(row.error ? { error: row.error } : {}) } : null;
    },
    async markReady(id, draft) {
      return move(id, "draft_queued", { state: "ready", draftPrNumber: draft.number, draftHeadSha: draft.headSha }, { to: "fix_ready", from: ["fix_queued"] });
    },
    async markFailed(id, from, error) {
      return move(id, from, { state: "failed", error: error.slice(0, 2000) }, { to: "reviewed", from: ["fix_queued", "fix_ready", "approved"] });
    },
    async decide(id, by, to, at, via = { via: "pessoa" }) {
      return move(id, "ready", { state: to, decidedBy: by, decidedAt: at, decidedVia: via.via, ...(via.via === "delegacao" ? { delegationNote: via.note } : {}) }, to === "approved" ? { to: "approved", from: ["fix_ready"] } : { to: "reviewed", from: ["fix_ready"] });
    },
    async noteDelegation(id, note) {
      await run((tx) => tx.update(fixRuns).set({ delegationNote: note.slice(0, 400) }).where(and(eq(fixRuns.orgId, orgId), eq(fixRuns.id, id))));
    },
    async markApplied(id) {
      return move(id, "approved", { state: "applied" }, { to: "applied", from: ["approved"] });
    },
    async fixesForAuthor(personId) {
      const rows = await fixRows(and(eq(fixRuns.state, "ready"), eq(pullRequests.authorId, personId), eq(pullRequests.state, "open")));
      return rows.map(({ f, p }) => ({
        fixId: f.id,
        pr: { repository: p.repository, number: p.number },
        draftPrNumber: f.draftPrNumber ?? 0,
        readyAt: f.createdAt,
        tests: f.testsReported && TESTS.has(f.testsReported as FixTestResult) ? (f.testsReported as FixTestResult) : "nao_rodou",
      }));
    },
  };
}

/** Nome e delegação escrita da pessoa, para o juiz da delegação (fix.delegation.of). */
export function pgDelegationOf(db: Database) {
  return async (orgId: string, personId: string): Promise<{ name: string; text: string | null; updatedAt?: Date } | null> => {
    const [p] = await withOrg(db, orgId, (tx) =>
      tx.select({ name: people.name, text: people.delegation, updatedAt: people.delegationUpdatedAt }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt))),
    );
    if (!p) return null;
    return { name: p.name.split(/\s+/)[0] ?? p.name, text: cleanAgentText(p.text), ...(p.updatedAt ? { updatedAt: p.updatedAt } : {}) };
  };
}
