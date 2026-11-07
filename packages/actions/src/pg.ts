// Entrada na fila de saída (outbox_actions) em Postgres. Só enfileira: quem executa é o `drain`, aqui em
// packages/actions, e ação que exige aprovação fica parada até ter `approvedBy`.
import { type Database, outboxActions, withOrg } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { type OutboxAction, REQUIRES_APPROVAL } from "./index.ts";

export function createPgOutbox(db: Database, orgId: string) {
  return {
    /** Idempotente pela chave: a mesma ação nunca entra duas vezes. */
    async enqueue(action: OutboxAction): Promise<{ id: string; duplicate: boolean }> {
      if (REQUIRES_APPROVAL[action.type] && !action.approvedBy) throw new Error(`${action.type} exige aprovação registrada`);
      return withOrg(db, orgId, async (tx) => {
        const [created] = await tx
          .insert(outboxActions)
          .values({ orgId, type: action.type, target: action.target, payload: action.payload, idempotencyKey: action.idempotencyKey, approvedBy: action.approvedBy ?? null, state: action.approvedBy || !REQUIRES_APPROVAL[action.type] ? "approved" : "pending" })
          .onConflictDoNothing()
          .returning({ id: outboxActions.id });
        if (created) return { id: created.id, duplicate: false };
        const [existing] = await tx
          .select({ id: outboxActions.id })
          .from(outboxActions)
          .where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.idempotencyKey, action.idempotencyKey)));
        return { id: existing!.id, duplicate: true };
      });
    },
  };
}
