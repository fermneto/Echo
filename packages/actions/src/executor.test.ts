import { FileChangedError, type ChatPlatform, type CodeWriter, type IssueWriter } from "@echo/connectors";
import { auditLog, brainNotes, createDb, createPool, identities, orgs, outboxActions, people, planItems, redistributionPlans, tasks } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { appRoleUrl } from "@echo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approveAction, drainActions, enqueueAction, releaseStuckActions } from "./executor.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("executor do outbox (Postgres real)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  // Código sob teste roda com um papel comum (sem BYPASSRLS) e sem o escopo de sistema:
  // fora de withOrg, as tabelas de negócio não devolvem nada.
  let appPool: ReturnType<typeof createPool>;
  let app: ReturnType<typeof createDb>;
  let orgId = "";
  const ids: Record<string, string> = {};
  const calls: string[] = [];
  const repoFiles = new Map<string, string>();
  let failNext = 0;

  const issues: IssueWriter = {
    assignIssue: async (issue, user) => {
      if (failNext-- > 0) throw new Error("Linear fora do ar");
      calls.push(`linear.assign ${issue} → ${user}`);
    },
    comment: async (issue, body) => (calls.push(`linear.comment ${issue}: ${body}`), { id: "c1" }),
  };
  const code: CodeWriter = {
    comment: async (repo, n, body) => (calls.push(`github.comment ${repo}#${n}: ${body}`), { id: "1" }),
    requestReviewers: async (repo, n, logins) => void calls.push(`github.reviewers ${repo}#${n}: ${logins.join(",")}`),
    // Repositório brains simulado: recusa quando o sha esperado não é o atual, como o GitHub.
    putFile: async (repo, path, content, _message, previousSha) => {
      const current = repoFiles.get(path);
      if (current !== previousSha) throw new FileChangedError(`${path} mudou`);
      const sha = `sha-${content.length}-${repoFiles.size}`;
      repoFiles.set(path, sha);
      calls.push(`github.put ${repo}/${path}`);
      return { sha };
    },
    deleteFile: async (repo, path, sha) => {
      if (repoFiles.get(path) !== sha) throw new FileChangedError(`${path} mudou`);
      repoFiles.delete(path);
      calls.push(`github.delete ${repo}/${path}`);
    },
  };
  const chat = {
    postAgentReply: async (i: { channel: string; text: string; agentName: string }) => (calls.push(`slack.post ${i.channel} [${i.agentName}]: ${i.text}`), { ts: "1" }),
    sendDm: async (u: string, i: { text: string }) => void calls.push(`slack.dm ${u}: ${i.text}`),
  } as unknown as ChatPlatform;
  // Montado na hora do uso: a conexão `app` só existe depois do beforeAll.
  const deps = () => ({ db: app, writers: async () => ({ issues, code, chat }) });

  beforeAll(async () => {
    appPool = createPool(await appRoleUrl(pool, url!), 2, { defaultScope: "none" });
    app = createDb(appPool);
    const [org] = await db.insert(orgs).values({ name: `Teste ações ${Math.random().toString(36).slice(2, 7)}` }).returning();
    orgId = org!.id;
    const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    for (const [k, name] of [["mar", "Marina"], ["car", "Carla"], ["bru", "Bruno"], ["yan", "Yan"]] as const) {
      const [p] = await db.insert(people).values({ orgId, name, timezone: "America/Sao_Paulo", workHours: wh }).returning();
      ids[k] = p!.id;
    }
    await db.insert(identities).values([
      { orgId, personId: ids.car!, platform: "linear", externalId: "lin-carla" },
      { orgId, personId: ids.car!, platform: "github", externalId: "102", login: "carla-dev" },
      { orgId, personId: ids.car!, platform: "slack", externalId: "UCAR" },
    ]);
    await db.insert(tasks).values([
      { orgId, key: "ECH-133", linearId: "lin-133", title: "Webhook de pagamentos", state: "todo", assigneeId: ids.bru },
      { orgId, key: "ECH-160", title: "Sem id no Linear", state: "todo" },
    ]);
  });

  afterAll(async () => {
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await Promise.all([pool.end(), appPool.end()]);
  });

  it("ação que exige aprovação fica pendente e não executa antes de aprovar", async () => {
    const a = await enqueueAction(app, orgId, { type: "linear.assign", target: "linear:ECH-133", idempotencyKey: "plano1:ECH-133", payload: { taskKey: "ECH-133", toPersonId: ids.car! } });
    expect((await drainActions(deps(), orgId)).done).toBe(0);
    expect(calls).toHaveLength(0);
    expect(await approveAction(app, orgId, a.id, ids.mar!)).toBe(true);
    expect(await approveAction(app, orgId, a.id, ids.mar!)).toBe(false); // já aprovada
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, "approve:linear.assign")));
    expect(audit!.actor).toBe(`person:${ids.mar}`);
  });

  it("aprovada, muda o responsável no Linear com a conta da pessoa e atualiza o espelho", async () => {
    expect(await drainActions(deps(), orgId)).toEqual({ done: 1, failed: 0, retried: 0 });
    expect(calls).toEqual(["linear.assign lin-133 → lin-carla"]);
    const [t] = await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.key, "ECH-133")));
    expect(t!.assigneeId).toBe(ids.car);
    // Rodar de novo não repete.
    expect((await drainActions(deps(), orgId)).done).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("mesma chave não cria segunda ação", async () => {
    const again = await enqueueAction(app, orgId, { type: "linear.assign", target: "linear:ECH-133", idempotencyKey: "plano1:ECH-133", payload: { taskKey: "ECH-133", toPersonId: ids.yan! }, approvedBy: ids.mar! });
    expect(again.duplicate).toBe(true);
    expect((await drainActions(deps(), orgId)).done).toBe(0);
  });

  it("pessoa sem conta no Linear ou tarefa sem id falham na hora, com motivo, e o item do plano fica falho", async () => {
    const [plan] = await db.insert(redistributionPlans).values({ orgId, trigger: "vacation" }).returning();
    const [item] = await db.insert(planItems).values({ orgId, planId: plan!.id, fromId: ids.bru!, toId: ids.yan!, state: "approved" }).returning();
    await enqueueAction(app, orgId, { type: "linear.assign", target: "linear:ECH-133", idempotencyKey: "plano2:yan", payload: { taskKey: "ECH-133", toPersonId: ids.yan!, planItemId: item!.id }, approvedBy: ids.mar! });
    await enqueueAction(app, orgId, { type: "linear.comment", target: "linear:ECH-160", idempotencyKey: "c160", payload: { taskKey: "ECH-160", body: "x" }, approvedBy: ids.mar! });
    expect(await drainActions(deps(), orgId)).toEqual({ done: 0, failed: 2, retried: 0 });
    const failed = await db.select().from(outboxActions).where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.state, "failed")));
    expect(failed.map((f) => f.error).sort()).toEqual(["pessoa sem conta no Linear", "tarefa ECH-160 sem id no Linear"]);
    const [it2] = await db.select().from(planItems).where(eq(planItems.id, item!.id));
    expect(it2!.state).toBe("failed");
  });

  it("falha temporária volta para a fila e para depois de 3 tentativas", async () => {
    await enqueueAction(app, orgId, { type: "linear.assign", target: "linear:ECH-133", idempotencyKey: "retry", payload: { taskKey: "ECH-133", toPersonId: ids.car! }, approvedBy: ids.mar! });
    failNext = 5;
    expect((await drainActions(deps(), orgId)).retried).toBe(1);
    expect((await drainActions(deps(), orgId)).retried).toBe(1);
    expect((await drainActions(deps(), orgId)).failed).toBe(1);
    expect((await drainActions(deps(), orgId)).failed).toBe(0); // esgotada, não tenta mais
    const [row] = await db.select().from(outboxActions).where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.idempotencyKey, "retry")));
    expect(row).toMatchObject({ state: "failed", attempts: 3, error: "Linear fora do ar" });
    failNext = 0;
  });

  it("comentário no PR e aviso no Slack não exigem aprovação; revisores e DM usam a conta de cada plataforma", async () => {
    calls.length = 0;
    await enqueueAction(app, orgId, { type: "github.comment", target: "github:org-teste/app#42", idempotencyKey: "rev:42:abc", payload: { repo: "org-teste/app", number: 42, body: "Análise automática do Echo. Isto não é uma aprovação." } });
    await enqueueAction(app, orgId, { type: "slack.post", target: "slack:C1", idempotencyKey: "aviso1", payload: { channel: "C1", text: "Plano aprovado por Marina." } });
    await enqueueAction(app, orgId, { type: "github.set_reviewers", target: "github:org-teste/app#36", idempotencyKey: "rv36", payload: { repo: "org-teste/app", number: 36, personIds: [ids.car!] }, approvedBy: ids.mar! });
    await enqueueAction(app, orgId, { type: "slack.dm", target: "slack:dm", idempotencyKey: "dm1", payload: { personId: ids.car!, text: "A ECH-133 agora é sua." } });
    expect((await drainActions(deps(), orgId)).done).toBe(4);
    expect(calls).toEqual([
      "github.comment org-teste/app#42: Análise automática do Echo. Isto não é uma aprovação.",
      "slack.post C1 [Echo]: Plano aprovado por Marina.",
      "github.reviewers org-teste/app#36: carla-dev",
      "slack.dm UCAR: A ECH-133 agora é sua.",
    ]);
  });

  it("espelho: escreve no brains sem aprovação, guarda o sha e nunca sobrescreve um arquivo que mudou no Git", async () => {
    calls.length = 0;
    const [note] = await db.insert(brainNotes).values({ orgId, path: "equipe/acordos.md", kind: "equipe", content: "Revisão até 24 h.", visibility: "team" }).returning();
    const payload = { repo: "org-teste/brains", noteId: note!.id, path: note!.path, content: "---\ntipo: equipe\n---\n\nRevisão até 24 h.\n" };
    await enqueueAction(app, orgId, { type: "github.mirror_write", target: "github:org-teste/brains", idempotencyKey: "mirror:1", payload });
    expect((await drainActions(deps(), orgId)).done).toBe(1);
    expect(calls).toEqual(["github.put org-teste/brains/equipe/acordos.md"]);
    const sha = repoFiles.get("equipe/acordos.md");
    expect((await db.select().from(brainNotes).where(eq(brainNotes.id, note!.id)))[0]!.sha).toBe(sha);

    // Alguém editou no Obsidian depois: o sha esperado não bate, e a escrita é recusada com motivo.
    repoFiles.set("equipe/acordos.md", "sha-editado-no-git");
    await enqueueAction(app, orgId, { type: "github.mirror_write", target: "github:org-teste/brains", idempotencyKey: "mirror:2", payload: { ...payload, content: "outra", previousSha: sha! } });
    expect((await drainActions(deps(), orgId)).failed).toBe(1);
    const [failed] = await db.select().from(outboxActions).where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.idempotencyKey, "mirror:2")));
    expect(failed!.error).toMatch(/mudou no Git/);
    expect(repoFiles.get("equipe/acordos.md")).toBe("sha-editado-no-git");
  });

  it("espelho: remove do brains a nota que não pode ficar lá, zera o sha e não apaga um arquivo que mudou", async () => {
    calls.length = 0;
    const [note] = await db.insert(brainNotes).values({ orgId, path: "agente-x/diario.md", kind: "diario", content: "Pessoal.", visibility: "person", sha: "sha-antigo" }).returning();
    repoFiles.set("agente-x/diario.md", "sha-editado");
    const payload = { repo: "org-teste/brains", noteId: note!.id, path: note!.path, sha: "sha-antigo" };
    await enqueueAction(app, orgId, { type: "github.mirror_delete", target: "github:org-teste/brains", idempotencyKey: "mirror-del:1", payload });
    expect((await drainActions(deps(), orgId)).failed).toBe(1);
    expect(repoFiles.has("agente-x/diario.md")).toBe(true);

    await enqueueAction(app, orgId, { type: "github.mirror_delete", target: "github:org-teste/brains", idempotencyKey: "mirror-del:2", payload: { ...payload, sha: "sha-editado" } });
    expect((await drainActions(deps(), orgId)).done).toBe(1);
    expect(calls).toEqual(["github.delete org-teste/brains/agente-x/diario.md"]);
    expect(repoFiles.has("agente-x/diario.md")).toBe(false);
    expect((await db.select().from(brainNotes).where(eq(brainNotes.id, note!.id)))[0]!.sha).toBeNull();
  });

  it("plataforma não ligada falha com motivo claro; ação presa em running volta para a fila", async () => {
    await enqueueAction(app, orgId, { type: "github.comment", target: "github:x#1", idempotencyKey: "semgh", payload: { repo: "x/y", number: 1, body: "b" } });
    expect((await drainActions({ db: app, writers: async () => ({}) }, orgId)).failed).toBe(1);
    const [stuck] = await db
      .insert(outboxActions)
      .values({ orgId, type: "slack.post", target: "slack:C1", payload: { channel: "C1", text: "preso" }, idempotencyKey: "preso", state: "running", attempts: 1, startedAt: new Date(Date.now() - 20 * 60_000) })
      .returning();
    expect(await releaseStuckActions(app)).toBeGreaterThanOrEqual(1);
    const [row] = await db.select().from(outboxActions).where(eq(outboxActions.id, stuck!.id));
    expect(row!.state).toBe("approved");
  });
});
