// F1: grava os eventos normalizados em work_events, tasks, pull_requests e contributions.
// Quem é quem sai da tabela identities. Sem correspondência, o fato fica sem pessoa: nunca adivinhar.
import { contributions, deployments, identities, pullRequests, tasks, withOrg, workEvents, type Database, type Tx } from "@echo/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { HELP_REACTIONS } from "./slack.ts";
import type { ExternalActor, ExternalPullRequest, ExternalTask, ExternalWorkEvent, NormalizedEvent, Platform } from "./normalized.ts";


/** Resolve atores externos em pessoas da empresa. GitHub compara o login sem diferenciar maiúsculas. */
async function resolvePeople(tx: Tx, orgId: string, actors: (ExternalActor | undefined)[]): Promise<(a?: ExternalActor) => string | null> {
  const list = actors.filter((a): a is ExternalActor => Boolean(a && (a.externalId || a.login)));
  if (list.length === 0) return () => null;
  const byPlatform = new Map<Platform, ExternalActor[]>();
  for (const a of list) byPlatform.set(a.platform, [...(byPlatform.get(a.platform) ?? []), a]);
  const found = new Map<string, string>();
  for (const [platform, group] of byPlatform) {
    const ids = [...new Set(group.flatMap((a) => (a.externalId ? [a.externalId] : [])))];
    const logins = [...new Set(group.flatMap((a) => (a.login ? [a.login.toLowerCase()] : [])))];
    const conds = [
      ...(ids.length ? [inArray(identities.externalId, ids)] : []),
      ...(logins.length ? [inArray(sql`lower(${identities.login})`, logins)] : []),
    ];
    const rows = await tx
      .select({ externalId: identities.externalId, login: identities.login, personId: identities.personId })
      .from(identities)
      .where(and(eq(identities.orgId, orgId), eq(identities.platform, platform), or(...conds)));
    for (const r of rows) {
      found.set(`${platform}:id:${r.externalId}`, r.personId);
      if (r.login) found.set(`${platform}:login:${r.login.toLowerCase()}`, r.personId);
    }
  }
  return (a) => {
    if (!a) return null;
    return (a.externalId && found.get(`${a.platform}:id:${a.externalId}`)) || (a.login && found.get(`${a.platform}:login:${a.login.toLowerCase()}`)) || null;
  };
}

const loginOf = (a?: ExternalActor) => a?.login ?? a?.externalId ?? null;

/**
 * Grava o fato uma vez. Se ele já existe sem pessoa e agora se sabe quem é (identidade ligada depois),
 * completa a pessoa e a hora da atribuição, sem criar outra linha.
 */
async function recordWorkEvent(tx: Tx, orgId: string, e: ExternalWorkEvent, personId: string | null): Promise<void> {
  await tx
    .insert(workEvents)
    .values({
      orgId,
      type: e.type,
      personId,
      repository: e.repository ?? null,
      branch: e.branch ?? null,
      prNumber: e.prNumber ?? null,
      taskKey: e.taskKey ?? null,
      occurredAt: e.occurredAt,
      source: e.source,
      sourceRef: e.sourceRef,
      externalLogin: loginOf(e.actor),
      attributedAt: personId ? new Date() : null,
      data: e.data ?? null,
    })
    .onConflictDoUpdate({
      target: [workEvents.orgId, workEvents.source, workEvents.sourceRef],
      set: { personId: sql`excluded.person_id`, attributedAt: sql`excluded.attributed_at` },
      where: sql`${workEvents.personId} is null and excluded.person_id is not null`,
    });
}

/** Coautoria no commit e revisão seguida de mudança no código viram crédito com fonte no GitHub. */
async function creditFromCommit(tx: Tx, orgId: string, e: ExternalWorkEvent, authorId: string | null): Promise<void> {
  if (!authorId) return;
  const coauthors = ((e.data?.coauthors ?? []) as { login?: string }[]).filter((c) => c.login);
  if (coauthors.length) {
    const resolve = await resolvePeople(tx, orgId, coauthors.map((c) => ({ platform: "github" as const, login: c.login })));
    for (const c of coauthors) {
      const helperId = resolve({ platform: "github", login: c.login });
      if (!helperId || helperId === authorId) continue;
      await tx
        .insert(contributions)
        .values({ orgId, helperId, helpedId: authorId, kind: "coauthor", weight: "forte", source: "github", sourceRef: e.sourceRef, confirmed: true, occurredAt: e.occurredAt, deliveryRef: e.taskKey ?? null })
        .onConflictDoNothing();
    }
  }
  if (!e.repository || !e.branch) return;
  const [pr] = await tx
    .select({ number: pullRequests.number })
    .from(pullRequests)
    .where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.repository, e.repository), eq(pullRequests.branch, e.branch), eq(pullRequests.state, "open")));
  if (!pr) return;
  const reviewers = await tx
    .selectDistinct({ personId: workEvents.personId })
    .from(workEvents)
    .where(
      and(
        eq(workEvents.orgId, orgId),
        eq(workEvents.repository, e.repository),
        eq(workEvents.prNumber, pr.number),
        inArray(workEvents.type, ["review", "review_comment"]),
        sql`${workEvents.personId} is not null and ${workEvents.personId} <> ${authorId}`,
        sql`${workEvents.occurredAt} < ${e.occurredAt.toISOString()}::timestamptz`,
      ),
    );
  for (const { personId } of reviewers) {
    await tx
      .insert(contributions)
      .values({ orgId, helperId: personId!, helpedId: authorId, kind: "review_change", weight: "forte", source: "github", sourceRef: `review_change:${e.repository}#${pr.number}`, confirmed: true, occurredAt: e.occurredAt, deliveryRef: e.taskKey ?? null })
      .onConflictDoNothing();
  }
}

/** Atualiza só se o dado for mais novo: avisos chegam fora de ordem. Arquivos não vêm no aviso e não são apagados. */
async function upsertPullRequest(tx: Tx, orgId: string, pr: ExternalPullRequest): Promise<void> {
  const resolve = await resolvePeople(tx, orgId, [pr.author, ...pr.reviewers]);
  const values = {
    title: pr.title,
    authorId: resolve(pr.author),
    state: pr.state,
    branch: pr.branch,
    headSha: pr.headSha ?? null,
    taskKey: pr.taskKey ?? null,
    reviewerIds: pr.reviewers.flatMap((r) => resolve(r) ?? []),
    openedAt: pr.openedAt ?? null,
    mergedAt: pr.mergedAt ?? null,
    externalUpdatedAt: pr.updatedAt,
    updatedAt: new Date(),
    // O aviso do GitHub não traz arquivos: só a consulta ao vivo grava, e nada apaga o que já se sabe.
    ...("files" in pr && Array.isArray((pr as { files?: unknown }).files) ? { files: (pr as { files: string[] }).files } : {}),
  };
  await tx
    .insert(pullRequests)
    .values({ orgId, repository: pr.repository, number: pr.number, ...values })
    .onConflictDoUpdate({
      target: [pullRequests.orgId, pullRequests.repository, pullRequests.number],
      set: values,
      where: sql`${pullRequests.externalUpdatedAt} is null or ${pullRequests.externalUpdatedAt} <= ${pr.updatedAt.toISOString()}::timestamptz`,
    });
}

async function upsertTask(tx: Tx, orgId: string, t: ExternalTask): Promise<void> {
  const resolve = await resolvePeople(tx, orgId, [t.assignee]);
  const values = {
    linearId: t.linearId,
    title: t.title,
    assigneeId: resolve(t.assignee),
    state: t.state,
    dueDate: t.dueDate ?? null,
    size: t.size ?? null,
    labels: t.labels,
    externalUpdatedAt: t.updatedAt,
    updatedAt: new Date(),
  };
  await tx
    .insert(tasks)
    .values({ orgId, key: t.key, ...values })
    .onConflictDoUpdate({
      target: [tasks.orgId, tasks.key],
      set: values,
      where: sql`${tasks.externalUpdatedAt} is null or ${tasks.externalUpdatedAt} <= ${t.updatedAt.toISOString()}::timestamptz`,
    });
}

/** Reação de ajuda: quem reagiu foi ajudado pelo autor da mensagem. Só a referência, nunca o texto. */
async function recordReaction(tx: Tx, orgId: string, r: Extract<NormalizedEvent, { kind: "reaction" }>): Promise<void> {
  if (!HELP_REACTIONS.has(r.reaction) || r.reactorExternalId === r.authorExternalId) return;
  const resolve = await resolvePeople(tx, orgId, [
    { platform: "slack", externalId: r.reactorExternalId },
    { platform: "slack", externalId: r.authorExternalId },
  ]);
  const helpedId = resolve({ platform: "slack", externalId: r.reactorExternalId });
  const helperId = resolve({ platform: "slack", externalId: r.authorExternalId });
  // Só vale com as contas de Slack das duas pessoas ligadas.
  if (!helpedId || !helperId) return;
  await tx
    .insert(contributions)
    .values({ orgId, helperId, helpedId, kind: "reaction", weight: "forte", source: "slack", sourceRef: `${r.channel}:${r.ts}`, confirmed: true, occurredAt: r.at })
    .onConflictDoNothing();
}

/** Checks do último commit do PR: só estado e link. Commit antigo não sobrescreve o atual. */
async function recordChecks(tx: Tx, orgId: string, c: Extract<NormalizedEvent, { kind: "checks" }>): Promise<void> {
  await tx
    .update(pullRequests)
    .set({ checksState: c.state, checksUrl: c.url, checksUpdatedAt: c.at, testsState: c.state })
    .where(
      and(
        eq(pullRequests.orgId, orgId),
        eq(pullRequests.repository, c.repository),
        inArray(pullRequests.number, c.prNumbers),
        or(sql`${pullRequests.headSha} is null`, eq(pullRequests.headSha, c.headSha)),
        or(sql`${pullRequests.checksUpdatedAt} is null`, sql`${pullRequests.checksUpdatedAt} <= ${c.at.toISOString()}::timestamptz`),
      ),
    );
}

/** Deploy por commit; aviso atrasado não volta o estado para trás. */
async function recordDeployment(tx: Tx, orgId: string, d: Extract<NormalizedEvent, { kind: "deployment" }>["deployment"]): Promise<void> {
  const values = { repository: d.repository ?? null, sha: d.sha ?? null, branch: d.branch ?? null, environment: d.environment, state: d.state, url: d.url ?? null, occurredAt: d.at, updatedAt: new Date() };
  await tx
    .insert(deployments)
    .values({ orgId, provider: d.provider, externalId: d.externalId, ...values })
    .onConflictDoUpdate({
      target: [deployments.orgId, deployments.provider, deployments.externalId],
      set: values,
      where: sql`${deployments.occurredAt} <= ${d.at.toISOString()}::timestamptz`,
    });
}

export interface IngestResult {
  orgId: string;
  applied: number;
  ignored: string[];
  /** Mensagens que seguem para o fluxo de resposta (F2), fora deste pacote. */
  messages: Extract<NormalizedEvent, { kind: "chat_message" }>["message"][];
}

/** Aplica os eventos de um aviso numa transação. Em erro, nada é gravado e a fila tenta de novo. */
export async function ingest(db: Database, orgId: string, events: NormalizedEvent[]): Promise<IngestResult> {
  const result: IngestResult = { orgId, applied: 0, ignored: [], messages: [] };
  // Tudo numa transação da empresa: o RLS garante que nada escapa para outra.
  await withOrg(db, orgId, async (tx) => {
    for (const ev of events) {
      switch (ev.kind) {
        case "work_event": {
          const resolve = await resolvePeople(tx, orgId, [ev.event.actor]);
          const personId = resolve(ev.event.actor);
          await recordWorkEvent(tx, orgId, ev.event, personId);
          if (ev.event.type === "commit") await creditFromCommit(tx, orgId, ev.event, personId);
          break;
        }
        case "pr_upsert":
          await upsertPullRequest(tx, orgId, ev.pr);
          break;
        case "task_upsert":
          await upsertTask(tx, orgId, ev.task);
          break;
        case "reaction":
          await recordReaction(tx, orgId, ev);
          break;
        case "checks":
          await recordChecks(tx, orgId, ev);
          break;
        case "deployment":
          await recordDeployment(tx, orgId, ev.deployment);
          break;
        case "chat_message":
          result.messages.push(ev.message);
          continue;
        case "ignored":
          result.ignored.push(ev.reason);
          continue;
      }
      result.applied++;
    }
  });
  return result;
}
