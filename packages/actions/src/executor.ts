// Executor do outbox: a ÚNICA peça que altera GitHub, Linear ou Slack.
// Cada ação tem chave única (não roda duas vezes), é reservada por atualização condicional
// (dois workers não executam a mesma) e só roda aprovada — exceto as listadas em REQUIRES_APPROVAL como false.
import { FileChangedError, GithubApiError, SlackApiError, trackerOfTaskId, type ChatPlatform, type CodeWriter, type IssueWriter } from "@echo/connectors";
import { asSystem, auditLog, brainNotes, identities, outboxActions, people, planItems, tasks, withOrg, type Database, type Tx } from "@echo/db";
import { isMirrorExportable, PatchConflictError, soleTeam } from "@echo/domain";
import { and, asc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { approvalAudit, draftPrRefusal, type ApprovalSource, type DraftPrPayload } from "./guards.ts";
import { insertAction } from "./pg.ts";
import { REQUIRES_APPROVAL, type ActionType, type OutboxAction } from "./index.ts";

export const MAX_ATTEMPTS = 3;
const MAX_PER_RUN = 20;

/** Cargas de cada tipo de ação. Pessoas por id do Echo; o executor acha a conta em cada plataforma. */
export interface ActionPayloads {
  "linear.assign": { taskKey: string; toPersonId: string | null; planItemId?: string };
  "linear.comment": { taskKey: string; body: string };
  "github.comment": { repo: string; number: number; body: string };
  "github.set_reviewers": { repo: string; number: number; personIds: string[]; planItemId?: string };
  "github.draft_pr": DraftPrPayload;
  "github.merge_fix": { repo: string; number: number; sha: string; base: string; prNumber: number };
  "github.mirror_write": { repo: string; noteId: string; path: string; content: string; previousSha?: string };
  "github.mirror_delete": { repo: string; noteId: string; path: string; sha: string };
  /** `ownerId`: a pessoa cujo gêmeo fala ("Agente de Fernando"); a mensagem sai com o bonequinho dela. */
  "slack.post": { channel: string; text: string; threadTs?: string; agentName?: string; ownerId?: string };
  "slack.dm": { personId: string; text: string; blocks?: unknown[] };
  /** Imagem na conversa privada; sem permissão de arquivo no Slack, manda o texto e os blocos de reserva. */
  "slack.dm_image": { personId: string; filename: string; title: string; comment: string; altText?: string; pngBase64: string; text: string; blocks?: unknown[] };
}

/** Erros do Slack em que adianta mandar a versão em texto em vez de repetir o envio do arquivo. */
const FILE_FALLBACK = new Set(["missing_scope", "not_allowed_token_type", "file_uploads_disabled", "file_type_not_allowed", "file_upload_size_restricted", "storage_limit_reached"]);

/** Erro que não adianta repetir (conta não ligada, tarefa inexistente): falha na hora, com o motivo. */
export class PermanentActionError extends Error {
  override name = "PermanentActionError";
}

export interface ExecutorDeps {
  db: Database;
  /** Escritores da empresa. Ausente = a plataforma não está ligada e a ação falha com esse motivo. */
  writers: (orgId: string) => Promise<{ code?: CodeWriter; issues?: IssueWriter; chat?: ChatPlatform }>;
  now?: () => Date;
  /**
   * Endereço do bonequinho para a mensagem no Slack: o do gêmeo de `ownerId` ou, sem dono, o do Echo.
   * Sem a função ou sem endereço (painel sem https), a mensagem sai com o ícone do app.
   */
  agentIcon?: (orgId: string, ownerId?: string) => Promise<string | undefined>;
}

type Row = typeof outboxActions.$inferSelect;

/** Coloca uma ação no outbox. A mesma chave não cria uma segunda ação. */
export async function enqueueAction<T extends ActionType>(db: Database, orgId: string, action: OutboxAction<ActionPayloads[T]> & { type: T }): Promise<{ id: string; duplicate: boolean }> {
  // Sem aprovação, a ação que exige aprovação fica "pending" até approveAction.
  return withOrg(db, orgId, (tx) => insertAction(tx, orgId, action));
}

/** Aprovação registrada: quem aprovou fica na ação e na auditoria. */
export async function approveAction(db: Database, orgId: string, actionId: string, approverId: string, source?: ApprovalSource): Promise<boolean> {
  return withOrg(db, orgId, async (tx) => {
    const [row] = await tx
      .update(outboxActions)
      .set({ state: "approved", approvedBy: approverId })
      .where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.id, actionId), eq(outboxActions.state, "pending")))
      .returning({ type: outboxActions.type, target: outboxActions.target });
    if (!row) return false;
    await tx.insert(auditLog).values(approvalAudit({ orgId, approverId, type: row.type, target: row.target, ...(source ? { source } : {}) }));
    return true;
  });
}

const TRACKER_NAME = { linear: "Linear", jira: "Jira" } as const;

async function trackerIdentity(tx: Tx, orgId: string, personId: string, platform: "linear" | "jira"): Promise<string> {
  const [id] = await tx
    .select({ externalId: identities.externalId })
    .from(identities)
    .where(and(eq(identities.orgId, orgId), eq(identities.personId, personId), eq(identities.platform, platform)));
  // Regra: tarefa do tracker só vai para quem tem conta lá.
  if (!id) throw new PermanentActionError(`pessoa sem conta no ${TRACKER_NAME[platform]}`);
  return id.externalId;
}

async function taskLinearId(tx: Tx, orgId: string, taskKey: string, platform: "linear" | "jira"): Promise<{ id: string; linearId: string }> {
  const [t] = await tx.select({ id: tasks.id, linearId: tasks.linearId }).from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.key, taskKey)));
  if (!t?.linearId) throw new PermanentActionError(`tarefa ${taskKey} sem id no ${TRACKER_NAME[platform]}`);
  // Um tracker por vez: depois da troca, a tarefa antiga (do outro tracker) fica no banco com a mesma chave.
  // O id denuncia a origem, e mandar ao Linear o id do Jira (ou o contrário) mexeria na tarefa errada.
  const owner = trackerOfTaskId(t.linearId);
  if (owner !== platform) throw new PermanentActionError(`tarefa ${taskKey} é do ${TRACKER_NAME[owner]}, e o tracker ligado é o ${TRACKER_NAME[platform]}`);
  return { id: t.id, linearId: t.linearId };
}

/**
 * Tipos que têm executor em `run()`. Mantenha junto do `switch`: o teste do executor falha se um caso
 * do `switch` faltar aqui, ou se um tipo daqui cair no `default`.
 */
export const EXECUTABLE_TYPES: readonly ActionType[] = [
  "linear.assign",
  "linear.comment",
  "github.comment",
  "github.draft_pr",
  "github.merge_fix",
  "github.set_reviewers",
  "github.mirror_write",
  "github.mirror_delete",
  "slack.post",
  "slack.dm",
  "slack.dm_image",
];

/** Erro gravado quando um worker sem o executor do tipo pega a ação. */
export const noExecutorError = (type: string) => `ação ${type} ainda não tem executor`;

/** Executa a ação. O que devolve fica em `outbox_actions.result` (ex.: número e versão do rascunho). */
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
      // "linear.assign" vale para o tracker ligado na empresa (Linear ou Jira): o nome ficou do primeiro.
      const p = row.payload as ActionPayloads["linear.assign"];
      const issues = need("issues", "Tracker de tarefas");
      const platform = issues.platform ?? "linear";
      const { task, assignee } = await withOrg(db, orgId, async (tx) => ({
        task: await taskLinearId(tx, orgId, p.taskKey, platform),
        assignee: p.toPersonId ? await trackerIdentity(tx, orgId, p.toPersonId, platform) : null,
      }));
      await issues.assignIssue(task.linearId, assignee);
      // Espelho local já reflete a mudança; o aviso do Linear confirma depois.
      await withOrg(db, orgId, (tx) => tx.update(tasks).set({ assigneeId: p.toPersonId, updatedAt: new Date() }).where(eq(tasks.id, task.id)));
      return;
    }
    case "linear.comment": {
      const p = row.payload as ActionPayloads["linear.comment"];
      const issues = need("issues", "Tracker de tarefas");
      const task = await withOrg(db, orgId, (tx) => taskLinearId(tx, orgId, p.taskKey, issues.platform ?? "linear"));
      await issues.comment(task.linearId, p.body);
      return;
    }
    case "github.comment": {
      const p = row.payload as ActionPayloads["github.comment"];
      await need("code", "GitHub").comment(p.repo, p.number, p.body);
      return;
    }
    case "github.draft_pr": {
      const p = row.payload as ActionPayloads["github.draft_pr"];
      // Sem aprovação e com escrita forçada na branch: confere branch e diff de novo antes de qualquer chamada.
      const refusal = draftPrRefusal(p);
      if (refusal) throw new PermanentActionError(refusal);
      try {
        return await need("code", "GitHub").createFixDraft({ repo: p.repo, base: p.base, baseSha: p.baseSha, branch: p.branch, title: p.title, body: p.body, patch: p.patch });
      } catch (err) {
        if (err instanceof PatchConflictError) throw new PermanentActionError(`o diff não se aplica ao código: ${err.message}`);
        throw err;
      }
    }
    case "github.merge_fix": {
      const p = row.payload as ActionPayloads["github.merge_fix"];
      try {
        return await need("code", "GitHub").mergeFix({ repo: p.repo, base: p.base, sha: p.sha, message: `Correção do Echo (#${p.number}) aprovada pelo autor do PR #${p.prNumber}` });
      } catch (err) {
        // 409: conflito com a branch do PR; 404: branch ou versão sumiu. Tentar de novo não resolve.
        if (err instanceof GithubApiError && (err.status === 409 || err.status === 404)) throw new PermanentActionError(err.status === 409 ? "conflito com a branch do PR" : "branch ou versão não encontrada");
        throw err;
      }
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
    case "github.mirror_write": {
      const p = row.payload as ActionPayloads["github.mirror_write"];
      // A nota pode ter ficado pessoal ou privada (ou a empresa ganhado outra equipe) depois de a ação entrar na fila.
      if (!(await stillExportable(db, orgId, p.noteId))) throw new PermanentActionError("a nota não pode mais ir para o espelho; a próxima sincronização a tira do repositório");
      let sha: string;
      try {
        ({ sha } = await need("code", "GitHub").putFile(p.repo, p.path, p.content, `Echo: atualiza ${p.path}`, p.previousSha));
      } catch (err) {
        if (err instanceof FileChangedError) throw new PermanentActionError("o arquivo mudou no Git; a próxima sincronização importa a edição");
        throw err;
      }
      // Ponto de sincronização: o blob que está no Git agora é o que o Echo escreveu.
      await withOrg(db, orgId, (tx) => tx.update(brainNotes).set({ sha }).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, p.noteId))));
      return;
    }
    case "github.mirror_delete": {
      const p = row.payload as ActionPayloads["github.mirror_delete"];
      try {
        await need("code", "GitHub").deleteFile(p.repo, p.path, p.sha, `Echo: remove ${p.path}, que não pode ficar no espelho`);
      } catch (err) {
        if (err instanceof FileChangedError) throw new PermanentActionError("o arquivo mudou no Git; a próxima sincronização tenta remover de novo");
        throw err;
      }
      await withOrg(db, orgId, (tx) => tx.update(brainNotes).set({ sha: null }).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, p.noteId))));
      return;
    }
    case "slack.post": {
      const p = row.payload as ActionPayloads["slack.post"];
      // O ícone é enfeite: se a busca falhar, a mensagem sai com o ícone do app em vez de não sair.
      const iconUrl = await deps.agentIcon?.(orgId, p.ownerId).catch(() => undefined);
      await need("chat", "Slack").postAgentReply({ channel: p.channel, text: p.text, agentName: p.agentName ?? "Echo", ...(p.threadTs ? { threadTs: p.threadTs } : {}), ...(iconUrl ? { iconUrl } : {}) });
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
    case "slack.dm_image": {
      const p = row.payload as ActionPayloads["slack.dm_image"];
      const [id] = await withOrg(db, orgId, (tx) =>
        tx
          .select({ externalId: identities.externalId })
          .from(identities)
          .where(and(eq(identities.orgId, orgId), eq(identities.personId, p.personId), eq(identities.platform, "slack"))),
      );
      if (!id) throw new PermanentActionError("pessoa sem conta no Slack");
      const chat = need("chat", "Slack");
      const fallback = () => chat.sendDm(id.externalId, { text: p.text, ...(Array.isArray(p.blocks) ? { blocks: p.blocks } : {}) });
      if (!chat.sendDmFile) return fallback();
      try {
        await chat.sendDmFile(id.externalId, { filename: p.filename, title: p.title, comment: p.comment, data: Buffer.from(p.pngBase64, "base64"), ...(p.altText ? { altText: p.altText } : {}) });
      } catch (err) {
        if (err instanceof SlackApiError && FILE_FALLBACK.has(err.code)) return fallback();
        throw err;
      }
      return;
    }
    default:
      throw new PermanentActionError(noExecutorError(row.type));
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
        await tx.update(outboxActions).set({ state: "done", error: null, ...(result !== undefined ? { result } : {}) }).where(eq(outboxActions.id, row.id));
        if (planItemId) await tx.update(planItems).set({ state: "done" }).where(and(eq(planItems.orgId, orgId), eq(planItems.id, planItemId)));
        await tx.insert(auditLog).values({ orgId, actor: "echo:actions", action: `execute:${row.type}`, target: row.target });
      });
      out.done++;
    } catch (err) {
      const permanent = err instanceof PermanentActionError;
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

/**
 * Ações que falharam só porque um worker antigo ainda não tinha o executor do tipo voltam para a fila
 * quando o executor passa a existir. Sem isso, a chave de idempotência impede que a ação seja criada de novo.
 * Volta aprovada se já tinha aprovação ou se o tipo não exige; senão volta pendente, à espera de aprovação.
 * Falha por qualquer outro motivo nunca é recolocada.
 */
export async function retryActionsWithoutExecutor(db: Database): Promise<number> {
  const noApproval = EXECUTABLE_TYPES.filter((t) => !REQUIRES_APPROVAL[t]);
  const approvedState = or(isNotNull(outboxActions.approvedBy), noApproval.length ? inArray(outboxActions.type, noApproval) : sql`false`);
  // Rotina de sistema: percorre todas as empresas.
  return asSystem(db, async (tx) => {
    const rows = await tx
      .update(outboxActions)
      .set({ state: sql`case when ${approvedState} then 'approved' else 'pending' end`, attempts: 0, error: null })
      .where(
        and(
          eq(outboxActions.state, "failed"),
          or(...EXECUTABLE_TYPES.map((t) => and(eq(outboxActions.type, t), eq(outboxActions.error, noExecutorError(t))))),
        ),
      )
      .returning({ orgId: outboxActions.orgId, type: outboxActions.type, target: outboxActions.target, state: outboxActions.state, payload: outboxActions.payload });
    for (const row of rows) {
      // O item do plano tinha ido para "failed" junto com a ação; volta para "approved" enquanto ela espera a fila.
      const planItemId = (row.payload as { planItemId?: string } | null)?.planItemId;
      if (planItemId && row.state === "approved")
        await tx.update(planItems).set({ state: "approved" }).where(and(eq(planItems.orgId, row.orgId), eq(planItems.id, planItemId), eq(planItems.state, "failed")));
      await tx.insert(auditLog).values({ orgId: row.orgId, actor: "echo:actions", action: `requeue:${row.type}`, target: row.target });
    }
    return rows.length;
  });
}

/** Confere de novo, na hora de escrever, se a nota ainda pode ir para o repositório (regra de packages/domain). */
async function stillExportable(db: Database, orgId: string, noteId: string): Promise<boolean> {
  return withOrg(db, orgId, async (tx) => {
    const [note] = await tx.select({ visibility: brainNotes.visibility, personId: brainNotes.personId }).from(brainNotes).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, noteId)));
    if (!note) return false;
    const staff = await tx.select({ id: people.id, role: people.role, teamId: people.teamId, active: people.active }).from(people).where(eq(people.orgId, orgId));
    const ownerTeamId = note.personId ? (staff.find((p) => p.id === note.personId)?.teamId ?? null) : null;
    return isMirrorExportable({ ...note, ownerTeamId }, soleTeam(staff));
  });
}
