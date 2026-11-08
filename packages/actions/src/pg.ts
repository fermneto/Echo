// Entrada na fila de saída (outbox_actions) em Postgres. Só enfileira: quem executa é o `drain`, aqui em
// packages/actions, e ação que exige aprovação fica parada até ter `approvedBy`.
import { auditLog, type Database, outboxActions, type Tx, withOrg } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { approvalAudit } from "./guards.ts";
import { type OutboxAction, REQUIRES_APPROVAL } from "./index.ts";

/**
 * Insere a ação na transação dada. Já aprovada por uma pessoa (`approvedBy`), grava também quem aprovou e por
 * onde no `audit_log`, na mesma transação: a aprovação nunca entra sem o registro.
 */
export async function insertAction<P>(tx: Tx, orgId: string, action: OutboxAction<P>): Promise<{ id: string; duplicate: boolean }> {
  const [row] = await tx
    .insert(outboxActions)
    .values({
      orgId,
      type: action.type,
      target: action.target,
      payload: action.payload,
      idempotencyKey: action.idempotencyKey,
      approvedBy: action.approvedBy ?? null,
      state: action.approvedBy || !REQUIRES_APPROVAL[action.type] ? "approved" : "pending",
    })
    .onConflictDoNothing()
    .returning({ id: outboxActions.id });
  if (row) {
    if (action.approvedBy) await tx.insert(auditLog).values(approvalAudit({ orgId, approverId: action.approvedBy, type: action.type, target: action.target, ...(action.approvalSource ? { source: action.approvalSource } : {}) }));
    return { id: row.id, duplicate: false };
  }
  const [existing] = await tx
    .select({ id: outboxActions.id })
    .from(outboxActions)
    .where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.idempotencyKey, action.idempotencyKey)));
  return { id: existing!.id, duplicate: true };
}

export function createPgOutbox(db: Database, orgId: string) {
  return {
    /** Idempotente pela chave: a mesma ação nunca entra duas vezes. */
    async enqueue(action: OutboxAction): Promise<{ id: string; duplicate: boolean }> {
      if (REQUIRES_APPROVAL[action.type] && !action.approvedBy) throw new Error(`${action.type} exige aprovação registrada`);
      return withOrg(db, orgId, (tx) => insertAction(tx, orgId, action));
    },
  };
}
