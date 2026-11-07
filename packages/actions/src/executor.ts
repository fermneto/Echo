// Executor do outbox: a ÚNICA peça que altera GitHub, Linear ou Slack.
// Cada ação tem chave única (não roda duas vezes), é reservada por atualização condicional
// (dois workers não executam a mesma) e só roda aprovada — exceto as listadas em REQUIRES_APPROVAL como false.
import { FixRefused, PatchError, type ChatPlatform, type CodeWriter, type FixDraftInput, type FixMergeInput, type IssueWriter } from "@echo/connectors";
import { asSystem, auditLog, identities, outboxActions, planItems, tasks, withOrg, type Database, type Tx } from "@echo/db";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { REQUIRES_APPROVAL, type ActionType, type OutboxAction } from "./index.ts";

export const MAX_ATTEMPTS = 3;
const MAX_PER_RUN = 20;

/** Cargas de cada tipo de ação. Pessoas por id do Echo; o executor acha a conta em cada plataforma. */
export interface ActionPayloads {
  "linear.assign": { taskKey: string; toPersonId: string | null; planItemId?: string };
  "linear.comment": { taskKey: string; body: string };
  "github.comment": { repo: string; number: number; body: string };
  "github.set_reviewers": { repo: string; number: number; personIds: string[]; planItemId?: string };
  "github.draft_pr": FixDraftInput & { prNumber?: number };
  "github.merge_fix": FixMergeInput;
  "slack.post": { channel: string; text: string; threadTs?: string; agentName?: string };
  "slack.dm": { personId: string; text: string; blocks?: unknown[] };
}

/** Erro que não adianta repetir (conta não ligada, tarefa inexistente): falha na hora, com o motivo. */
export class PermanentActionError extends Error {
  override name = "PermanentActionError";
}

export interface ExecutorDeps {
  db: Database;
  /** Escritores da empresa. Ausente = a plataforma não está ligada e a ação falha com esse motivo. */
  writers: (orgId: string) => Promise<{ code?: CodeWriter; issues?: IssueWriter; chat?: ChatPlatform }>;
  now?: () => Date;
}

type Row = typeof outboxActions.$inferSelect;

/** Coloca uma ação no outbox. A mesma chave não cria uma segunda ação. */
export async function enqueueAction<T extends ActionType>(db: Database, orgId: string, action: OutboxAction<ActionPayloads[T]> & { type: T }): Promise<{ id: string; duplicate: boolean }> {
  // Sem aprovação, a ação que exige aprovação fica "pending" até approveAction.
  return withOrg(db, orgId, async (tx) => {
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
  if (row) return { id: row.id, duplicate: false };
  const [existing] = await tx
    .select({ id: outboxActions.id })
    .from(outboxActions)
    .where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.idempotencyKey, action.idempotencyKey)));
  return { id: existing!.id, duplicate: true };
  });
}

/** Aprovação registrada: quem aprovou fica na ação e na auditoria. */
export async function approveAction(db: Database, orgId: string, actionId: string, approverId: string): Promise<boolean> {
  return withOrg(db, orgId, async (tx) => {
    const [row] = await tx
      .update(outboxActions)
      .set({ state: "approved", approvedBy: approverId })
      .where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.id, actionId), eq(outboxActions.state, "pending")))
      .returning({ type: outboxActions.type, target: outboxActions.target });
    if (!row) return false;
    await tx.insert(auditLog).values({ orgId, actor: `person:${approverId}`, action: `approve:${row.type}`, target: row.target });
    return true;
  });
}

async function linearIdentity(tx: Tx, orgId: string, personId: string): Promise<string> {
  const [id] = await tx
    .select({ externalId: identities.externalId })
    .from(identities)
    .where(and(eq(identities.orgId, orgId), eq(identities.personId, personId), eq(identities.platform, "linear")));
  // Regra: tarefa do Linear só vai para quem tem conta lá.
  if (!id) throw new PermanentActionError("pessoa sem conta no Linear");
  return id.externalId;
}

async function taskLinearId(tx: Tx, orgId: string, taskKey: string): Promise<{ id: string; linearId: string }> {
  const [t] = await tx.select({ id: tasks.id, linearId: tasks.linearId }).from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.key, taskKey)));
  if (!t?.linearId) throw new PermanentActionError(`tarefa ${taskKey} sem id no Linear`);
  return { id: t.id, linearId: t.linearId };
}

/** O que a execução devolve fica em `outbox_actions.result`, para o fluxo que pediu a ação (ex.: o rascunho). */
async function run(deps: ExecutorDeps, row: Row): Promise<unknown> {
  const { db } = deps;
  const orgId = row.orgId;
  const w = await deps.writers(orgId);
  const need = <K extends keyof typeof w>(k: K, name: string): NonNullable<(typeof w)[K]> => {
    if (!w[k]) throw new PermanentActionError(`${name} não está ligado nesta empresa`);
    return w[k]!;
  };
  switch (row.type as ActionType) {
    case "linear.assign": {
      const p = row.payload as ActionPayloads["linear.assign"];
      const { task, assignee } = await withOrg(db, orgId, async (tx) => ({
        task: await taskLinearId(tx, orgId, p.taskKey),
        assignee: p.toPersonId ? await linearIdentity(tx, orgId, p.toPersonId) : null,
      }));
      await need("issues", "Linear").assignIssue(task.linearId, assignee);
      // Espelho local já reflete a mudança; o aviso do Linear confirma depois.
      await withOrg(db, orgId, (tx) => tx.update(tasks).set({ assigneeId: p.toPersonId, updatedAt: new Date() }).where(eq(tasks.id, task.id)));
      return;
    }
    case "linear.comment": {
      const p = row.payload as ActionPayloads["linear.comment"];
      const task = await withOrg(db, orgId, (tx) => taskLinearId(tx, orgId, p.taskKey));
      await need("issues", "Linear").comment(task.linearId, p.body);
      return;
    }
    case "github.comment": {
      const p = row.payload as ActionPayloads["github.comment"];
      await need("code", "GitHub").comment(p.repo, p.number, p.body);
      return;
    }
    case "github.set_reviewers": {
      const p = row.payload as ActionPayloads["github.set_reviewers"];
      const rows = p.personIds.length
        ? await withOrg(db, orgId, (tx) =>
            tx
              .select({ login: identities.login, personId: identities.personId })
              .from(identities)
              .where(and(eq(identities.orgId, orgId), eq(identities.platform, "github"), inArray(identities.personId, p.personIds))),
          )
        : [];
      const logins = rows.flatMap((r) => (r.login ? [r.login] : []));
      if (logins.length < p.personIds.length) throw new PermanentActionError("revisor sem conta no GitHub");
      await need("code", "GitHub").requestReviewers(p.repo, p.number, logins);
      return;
    }
    case "github.draft_pr": {
      const p = row.payload as ActionPayloads["github.draft_pr"];
      const code = need("code", "GitHub");
      if (!code.openFixDraft) throw new PermanentActionError("o GitHub ligado não abre rascunho de correção");
      return code.openFixDraft(p);
    }
    case "github.merge_fix": {
      const p = row.payload as ActionPayloads["github.merge_fix"];
      // Defesa em profundidade: união só com aprovação registrada (a fila já não deixa rodar sem ela).
      if (!row.approvedBy) throw new PermanentActionError("união sem aprovação registrada");
      const code = need("code", "GitHub");
      if (!code.mergeFix) throw new PermanentActionError("o GitHub ligado não une correção");
      return code.mergeFix(p);
    }
    case "slack.post": {
      const p = row.payload as ActionPayloads["slack.post"];
      await need("chat", "Slack").postAgentReply({ channel: p.channel, text: p.text, agentName: p.agentName ?? "Echo", ...(p.threadTs ? { threadTs: p.threadTs } : {}) });
      return;
    }
    case "slack.dm": {
      const p = row.payload as ActionPayloads["slack.dm"];
      const [id] = await withOrg(db, orgId, (tx) =>
        tx
          .select({ externalId: identities.externalId })
          .from(identities)
          .where(and(eq(identities.orgId, orgId), eq(identities.personId, p.personId), eq(identities.platform, "slack"))),
      );
      if (!id) throw new PermanentActionError("pessoa sem conta no Slack");
      await need("chat", "Slack").sendDm(id.externalId, { text: p.text, ...(Array.isArray(p.blocks) ? { blocks: p.blocks } : {}) });
      return;
    }
    default:
      throw new PermanentActionError(`ação ${row.type} ainda não tem executor`);
  }
}

/**
 * Executa as ações aprovadas da empresa, até 20 por rodada, em ordem de criação.
 * Falha temporária volta para a fila (até 3 tentativas); falha permanente ou esgotada fica "failed", visível.
 */
export async function drainActions(deps: ExecutorDeps, orgId: string): Promise<{ done: number; failed: number; retried: number }> {
  const { db } = deps;
  const out = { done: 0, failed: 0, retried: 0 };
  const candidates = await withOrg(db, orgId, (tx) =>
    tx
      .select()
      .from(outboxActions)
      .where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.state, "approved"), lt(outboxActions.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(outboxActions.createdAt))
      .limit(MAX_PER_RUN),
  );

  for (const c of candidates) {
    // Reserva: só um worker consegue passar de approved para running.
    const [row] = await withOrg(db, orgId, (tx) =>
      tx
        .update(outboxActions)
        .set({ state: "running", attempts: sql`${outboxActions.attempts} + 1`, startedAt: new Date() })
        .where(and(eq(outboxActions.id, c.id), eq(outboxActions.state, "approved")))
        .returning(),
    );
    if (!row) continue;
    const planItemId = (row.payload as { planItemId?: string }).planItemId;
    try {
      const result = await run(deps, row);
      await withOrg(db, orgId, async (tx) => {
        await tx.update(outboxActions).set({ state: "done", error: null, ...(result === undefined ? {} : { result }) }).where(eq(outboxActions.id, row.id));
        if (planItemId) await tx.update(planItems).set({ state: "done" }).where(and(eq(planItems.orgId, orgId), eq(planItems.id, planItemId)));
        await tx.insert(auditLog).values({ orgId, actor: "echo:actions", action: `execute:${row.type}`, target: row.target });
      });
      out.done++;
    } catch (err) {
      // Correção recusada pelo GitHub (rascunho mudou, conflito) ou diff que não aplica: repetir não muda nada.
      const permanent = err instanceof PermanentActionError || err instanceof FixRefused || err instanceof PatchError;
      const exhausted = permanent || row.attempts >= MAX_ATTEMPTS;
      const message = err instanceof Error ? err.message.slice(0, 500) : "erro";
      await withOrg(db, orgId, async (tx) => {
        await tx.update(outboxActions).set({ state: exhausted ? "failed" : "approved", error: message }).where(eq(outboxActions.id, row.id));
        if (exhausted && planItemId) await tx.update(planItems).set({ state: "failed" }).where(and(eq(planItems.orgId, orgId), eq(planItems.id, planItemId)));
      });
      if (exhausted) out.failed++;
      else out.retried++;
    }
  }
  return out;
}

/** Empresas com ações a executar: o worker passa por elas a cada rodada. */
export async function orgsWithApprovedActions(db: Database): Promise<string[]> {
  // Rotina de sistema: percorre todas as empresas.
  const rows = await asSystem(db, (tx) =>
    tx.selectDistinct({ orgId: outboxActions.orgId }).from(outboxActions).where(and(eq(outboxActions.state, "approved"), lt(outboxActions.attempts, MAX_ATTEMPTS))),
  );
  return rows.map((r) => r.orgId);
}

/** Ações presas em "running" por um worker que caiu voltam para a fila depois de 10 minutos. */
export async function releaseStuckActions(db: Database, olderThanMs = 10 * 60_000): Promise<number> {
  // Rotina de sistema: percorre todas as empresas.
  const rows = await asSystem(db, (tx) =>
    tx
      .update(outboxActions)
      .set({ state: "approved" })
      .where(and(eq(outboxActions.state, "running"), lt(outboxActions.startedAt, new Date(Date.now() - olderThanMs)), lt(outboxActions.attempts, MAX_ATTEMPTS)))
      .returning({ id: outboxActions.id }),
  );
  return rows.length;
}

