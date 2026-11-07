// Resumo da ausência em Postgres. Toda consulta em withOrg com filtro explícito de org_id. Entrega e limpeza só
// mexem nas linhas do resumo: a pergunta continua para os Ganhos, sem texto.
import { type Database, people, questions, withOrg } from "@echo/db";
import type { DigestKind } from "@echo/domain";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, max, or } from "drizzle-orm";
import type { DigestStore } from "./away-digest.ts";

const KINDS: ReadonlySet<string> = new Set(["reuniao", "proposta", "decisao", "nenhum"]);

export function createPgDigestStore(db: Database, orgId: string): DigestStore {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);
  return {
    async lastSentAt(personId) {
      const [r] = await run((tx) => tx.select({ at: max(questions.digestedAt) }).from(questions).where(and(eq(questions.orgId, orgId), eq(questions.ownerId, personId))));
      return r?.at ?? null;
    },
    async pending(personId, since) {
      const rows = await run((tx) =>
        tx
          .select({ id: questions.id, askerId: questions.askerId, kind: questions.digestKind, state: questions.state, needsOwner: questions.needsOwner, request: questions.digestRequest, reply: questions.digestReply, createdAt: questions.createdAt })
          .from(questions)
          .where(and(eq(questions.orgId, orgId), eq(questions.ownerId, personId), isNull(questions.digestedAt), isNotNull(questions.digestRequest), gte(questions.createdAt, since)))
          .orderBy(asc(questions.createdAt), asc(questions.id)),
      );
      return rows.map((r) => ({
        id: r.id,
        askerId: r.askerId ?? undefined,
        kind: r.kind && KINDS.has(r.kind) ? (r.kind as DigestKind) : null,
        state: r.state,
        needsOwner: r.needsOwner,
        request: r.request ?? undefined,
        reply: r.reply ?? undefined,
        createdAt: r.createdAt,
      }));
    },
    async markDelivered(ids, at) {
      if (ids.length === 0) return 0;
      const rows = await run((tx) =>
        tx
          .update(questions)
          .set({ digestedAt: at, digestRequest: null, digestReply: null })
          .where(and(eq(questions.orgId, orgId), inArray(questions.id, ids), isNull(questions.digestedAt)))
          .returning({ id: questions.id }),
      );
      return rows.length;
    },
    async purge(before) {
      const rows = await run((tx) =>
        tx
          .update(questions)
          .set({ digestRequest: null, digestReply: null })
          .where(
            and(
              eq(questions.orgId, orgId),
              or(isNotNull(questions.digestRequest), isNotNull(questions.digestReply)),
              or(
                lt(questions.createdAt, before),
                // Ao desligar a pessoa (ou deixá-la inativa), as linhas dela somem.
                inArray(questions.ownerId, tx.select({ id: people.id }).from(people).where(and(eq(people.orgId, orgId), or(isNotNull(people.offboardedAt), eq(people.active, false))))),
              ),
            ),
          )
          .returning({ id: questions.id }),
      );
      return rows.length;
    },
  };
}
