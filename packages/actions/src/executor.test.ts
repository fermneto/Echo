import { FileChangedError, GithubApiError, SlackApiError, type ChatPlatform, type CodeWriter, type IssueWriter } from "@echo/connectors";
import { auditLog, brainNotes, createDb, createPool, identities, orgs, outboxActions, people, planItems, redistributionPlans, tasks } from "@echo/db";
import { PatchConflictError } from "@echo/domain";
import { and, eq, inArray } from "drizzle-orm";
import { appRoleUrl } from "@echo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REQUIRES_APPROVAL, type ActionType } from "./index.ts";
import { approveAction, drainActions, enqueueAction, EXECUTABLE_TYPES, noExecutorError, releaseStuckActions, retryActionsWithoutExecutor } from "./executor.ts";

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
    createFixDraft: async (i) => {
      if (i.patch.includes("conflito")) throw new PatchConflictError("contexto não bate na linha 3");
      calls.push(`github.draft ${i.repo} ${i.branch} → ${i.base} sobre ${i.baseSha}`);
      return { number: 77, headSha: "draftsha" };
    },
    mergeFix: async (i) => {
      if (i.sha === "mudou") throw new GithubApiError(409, `/repos/${i.repo}/merges`, "Merge conflict");
      calls.push(`github.merge ${i.sha} → ${i.base}`);
      return { sha: "mergesha" };
    },
    deleteFile: async (repo, path, sha) => {
      if (repoFiles.get(path) !== sha) throw new FileChangedError(`${path} mudou`);
      repoFiles.delete(path);
      calls.push(`github.delete ${repo}/${path}`);
    },
  };
  const chat = {
    postAgentReply: async (i: { channel: string; text: string; agentName: string; iconUrl?: string }) => (calls.push(`slack.post ${i.channel} [${i.agentName}]${i.iconUrl ? ` (${i.iconUrl})` : ""}: ${i.text}`), { ts: "1" }),
    sendDm: async (u: string, i: { text: string; blocks?: unknown[] }) => void calls.push(`slack.dm ${u}: ${i.text}${i.blocks ? ` [${i.blocks.length} blocos]` : ""}`),
    sendDmFile: async (u: string, i: { filename: string; data: Uint8Array; comment: string }) => {
      if (fileScopeMissing) throw new SlackApiError("files.getUploadURLExternal", "missing_scope");
      calls.push(`slack.file ${u}: ${i.filename} (${i.data.byteLength} bytes) ${i.comment}`);
    },
    sendChannelFile: async (c: string, i: { filename: string; data: Uint8Array; comment: string }) => {
      if (fileScopeMissing) throw new SlackApiError("files.getUploadURLExternal", "missing_scope");
      if (c === "C0FORA0001") throw new SlackApiError("files.completeUploadExternal", "not_in_channel");
      calls.push(`slack.channel_file ${c}: ${i.filename} (${i.data.byteLength} bytes) ${i.comment}`);
    },
  } as unknown as ChatPlatform;
  let fileScopeMissing = false;
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
    await enqueueAction(app, orgId, { type: "slack.dm", target: "slack:dm", idempotencyKey: "dm1", payload: { personId: ids.car!, text: "A ECH-133 agora é sua.", blocks: [{ type: "section" }] } });
    expect((await drainActions(deps(), orgId)).done).toBe(4);
    expect(calls).toEqual([
      "github.comment org-teste/app#42: Análise automática do Echo. Isto não é uma aprovação.",
      "slack.post C1 [Echo]: Plano aprovado por Marina.",
      "github.reviewers org-teste/app#36: carla-dev",
      "slack.dm UCAR: A ECH-133 agora é sua. [1 blocos]",
    ]);
  });

  it("mensagem em nome do gêmeo sai com o bonequinho dele; sem dono, com o do Echo; se o ícone falha, sai mesmo assim", async () => {
    calls.length = 0;
    const asked: (string | undefined)[] = [];
    const agentIcon = async (_org: string, ownerId?: string) => {
      asked.push(ownerId);
      if (ownerId === "quebra") throw new Error("banco fora do ar");
      return ownerId ? `https://echo.exemplo.com/api/avatar/o/${ownerId}?v=1` : "https://echo.exemplo.com/api/avatar/echo?v=1";
    };
    await enqueueAction(app, orgId, { type: "slack.post", target: "slack:C1", idempotencyKey: "gemeo1", payload: { channel: "C1", text: "Carla deixou a branch liberada.", agentName: "Agente de Carla", ownerId: ids.car! } });
    await enqueueAction(app, orgId, { type: "slack.post", target: "slack:C1", idempotencyKey: "echo1", payload: { channel: "C1", text: "Plano aprovado." } });
    await enqueueAction(app, orgId, { type: "slack.post", target: "slack:C1", idempotencyKey: "quebra1", payload: { channel: "C1", text: "Sem ícone.", agentName: "Agente de Bruno", ownerId: "quebra" } });
    expect((await drainActions({ ...deps(), agentIcon }, orgId)).done).toBe(3);
    expect(asked).toEqual([ids.car!, undefined, "quebra"]);
    expect(calls).toEqual([
      `slack.post C1 [Agente de Carla] (https://echo.exemplo.com/api/avatar/o/${ids.car!}?v=1): Carla deixou a branch liberada.`,
      "slack.post C1 [Echo] (https://echo.exemplo.com/api/avatar/echo?v=1): Plano aprovado.",
      "slack.post C1 [Agente de Bruno]: Sem ícone.",
    ]);
  });

  it("imagem no privado sem aprovação; sem permissão de arquivo no Slack, vai a versão em blocos", async () => {
    calls.length = 0;
    const payload = { personId: ids.car!, filename: "resumo-2026-11-07.png", title: "Resumo do dia, 07/11", comment: "Resumo do seu dia", pngBase64: Buffer.from([137, 80, 78, 71]).toString("base64"), text: "Resumo do seu dia, 07/11", blocks: [{ type: "header" }, { type: "section" }] };
    await enqueueAction(app, orgId, { type: "slack.dm_image", target: "person:carla", idempotencyKey: "img1", payload });
    expect((await drainActions(deps(), orgId)).done).toBe(1);
    fileScopeMissing = true;
    await enqueueAction(app, orgId, { type: "slack.dm_image", target: "person:carla", idempotencyKey: "img2", payload });
    expect((await drainActions(deps(), orgId)).done).toBe(1);
    fileScopeMissing = false;
    expect(calls).toEqual(["slack.file UCAR: resumo-2026-11-07.png (4 bytes) Resumo do seu dia", "slack.dm UCAR: Resumo do seu dia, 07/11 [2 blocos]"]);
  });

  it("vídeo da semana no canal sem aprovação: lê o mp4 na hora, sem bytes no outbox; sem permissão de arquivo, posta o texto; arquivo vencido e bot fora do canal falham de vez", async () => {
    calls.length = 0;
    const read: string[] = [];
    const videoBytes = async (_org: string, key: string) => (read.push(key), key === "file_vencido" ? null : new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
    const payload = (storageKey: string, channel = "C0PRODUTO1") => ({ channel, videoId: "v1", storageKey, filename: "video-da-semana-2026-W45.mp4", title: "Vídeo da semana · Produto · 2 a 6/11", comment: "*Vídeo da semana da equipe Produto* · 2 a 6/11", text: "Assista no painel do Echo, em Relatórios e comentem aqui na thread." });
    const post = (key: string, p: ReturnType<typeof payload>) => enqueueAction(app, orgId, { type: "slack.post_video", target: `slack:${p.channel}`, idempotencyKey: key, payload: p });
    const a = await post("vid1", payload("file_mp4"));
    const [queued] = await db.select().from(outboxActions).where(eq(outboxActions.id, a.id));
    expect(queued!.state).toBe("approved");
    expect(JSON.stringify(queued!.payload)).not.toContain("base64");
    expect((await drainActions({ ...deps(), videoBytes }, orgId)).done).toBe(1);
    fileScopeMissing = true;
    await post("vid2", payload("file_mp4"));
    expect((await drainActions({ ...deps(), videoBytes }, orgId)).done).toBe(1);
    fileScopeMissing = false;
    // Worker sem a leitura do arquivo (sem chave): posta o texto, que diz onde assistir.
    await post("vid3", payload("file_mp4"));
    expect((await drainActions(deps(), orgId)).done).toBe(1);
    const gone = await post("vid4", payload("file_vencido"));
    const outside = await post("vid5", payload("file_mp4", "C0FORA0001"));
    expect(await drainActions({ ...deps(), videoBytes }, orgId)).toEqual({ done: 0, failed: 2, retried: 0 });
    const failed = await db.select().from(outboxActions).where(and(eq(outboxActions.orgId, orgId), inArray(outboxActions.id, [gone.id, outside.id])));
    expect(failed.find((f) => f.id === gone.id)).toMatchObject({ state: "failed", attempts: 1, error: "o arquivo do vídeo não existe mais (vencido ou apagado)" });
    expect(failed.find((f) => f.id === outside.id)).toMatchObject({ state: "failed", attempts: 1, error: "o Echo não está no canal C0FORA0001: convide o Echo para o canal e o próximo vídeo sai lá" });
    // Mesma chave não posta de novo.
    expect((await post("vid1", payload("file_mp4"))).duplicate).toBe(true);
    expect(read).toEqual(["file_mp4", "file_mp4", "file_vencido", "file_mp4"]);
    expect(calls).toEqual([
      "slack.channel_file C0PRODUTO1: video-da-semana-2026-W45.mp4 (8 bytes) *Vídeo da semana da equipe Produto* · 2 a 6/11",
      "slack.post C0PRODUTO1 [Echo]: Assista no painel do Echo, em Relatórios e comentem aqui na thread.",
      "slack.post C0PRODUTO1 [Echo]: Assista no painel do Echo, em Relatórios e comentem aqui na thread.",
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

  it("espelho: nota que virou pessoal depois de entrar na fila não é escrita", async () => {
    calls.length = 0;
    const [note] = await db.insert(brainNotes).values({ orgId, path: "equipe/regras.md", kind: "equipe", content: "Regra.", visibility: "team" }).returning();
    await enqueueAction(app, orgId, { type: "github.mirror_write", target: "github:org-teste/brains", idempotencyKey: "mirror:pessoal", payload: { repo: "org-teste/brains", noteId: note!.id, path: note!.path, content: "Regra.\n" } });
    await db.update(brainNotes).set({ visibility: "person" }).where(eq(brainNotes.id, note!.id));
    expect((await drainActions(deps(), orgId)).failed).toBe(1);
    expect(calls).toEqual([]);
    expect(repoFiles.has("equipe/regras.md")).toBe(false);
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
  it("correção: rascunho sem aprovação guarda número e versão; união só aprovada; diff que não se aplica falha de vez", async () => {
    calls.length = 0;
    const patch = (line: string) => ["diff --git a/src/a.ts b/src/a.ts", "--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1 @@", "-a", `+${line}`, ""].join("\n");
    const draft = { repo: "org/app", prNumber: 1, base: "feat", baseSha: "abc", branch: "echo/fix-pr-1", title: "t", body: "b", patch: patch("b"), prFiles: ["src/a.ts"] };
    await enqueueAction(app, orgId, { type: "github.draft_pr", target: "github:org/app#1", idempotencyKey: "fix_draft:f1", payload: draft });
    await enqueueAction(app, orgId, { type: "github.draft_pr", target: "github:org/app#2", idempotencyKey: "fix_draft:f2", payload: { ...draft, patch: patch("conflito") } });
    // Sem aprovação e com escrita forçada: branch que não é echo/fix-pr-N e diff malformado nem chegam ao GitHub.
    await enqueueAction(app, orgId, { type: "github.draft_pr", target: "github:org/app#3", idempotencyKey: "fix_draft:f3", payload: { ...draft, branch: "feat" } });
    await enqueueAction(app, orgId, { type: "github.draft_pr", target: "github:org/app#4", idempotencyKey: "fix_draft:f4", payload: { ...draft, patch: ["diff --git X", "@@ -0,0 +1 @@", "+x", draft.patch].join("\n") } });
    const merge = await enqueueAction(app, orgId, { type: "github.merge_fix", target: "github:org/app#77", idempotencyKey: "fix_merge:f1", payload: { repo: "org/app", number: 77, sha: "draftsha", base: "feat", prNumber: 1 } });
    await drainActions(deps(), orgId); // o teste anterior deixa uma ação de volta na fila
    const rows = await db.select().from(outboxActions).where(eq(outboxActions.orgId, orgId));
    const byKey = (k: string) => rows.find((r) => r.idempotencyKey === k)!;
    expect(byKey("fix_draft:f1")).toMatchObject({ state: "done", result: { number: 77, headSha: "draftsha" } });
    expect(byKey("fix_draft:f2")).toMatchObject({ state: "failed", error: "o diff não se aplica ao código: contexto não bate na linha 3" });
    expect(byKey("fix_draft:f3")).toMatchObject({ state: "failed", error: expect.stringMatching(/^branch recusada/) });
    expect(byKey("fix_draft:f4")).toMatchObject({ state: "failed", error: expect.stringMatching(/^diff recusado: diff malformado/) });
    expect(byKey("fix_merge:f1").state).toBe("pending");
    expect(await approveAction(app, orgId, merge.id, ids.car!, "painel")).toBe(true);
    await enqueueAction(app, orgId, { type: "github.merge_fix", target: "github:org/app#78", idempotencyKey: "fix_merge:f2", payload: { repo: "org/app", number: 78, sha: "mudou", base: "feat", prNumber: 2 }, approvedBy: ids.car!, approvalSource: "slack" });
    // As duas aprovações ficam no audit_log com a pessoa e a origem.
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.actor, `person:${ids.car}`)));
    expect(audit.map((a) => `${a.action} ${a.target}`).sort()).toEqual(["approve:github.merge_fix:painel github:org/app#77", "approve:github.merge_fix:slack github:org/app#78"]);
    expect(await drainActions(deps(), orgId)).toEqual({ done: 1, failed: 1, retried: 0 });
    expect(calls.filter((c) => c.startsWith("github."))).toEqual(["github.draft org/app echo/fix-pr-1 → feat sobre abc", "github.merge draftsha → feat"]);
  });

  it("ação que falhou por falta de executor volta para a fila; sem aprovação, volta pendente; outra falha fica", async () => {
    calls.length = 0;
    await drainActions(deps(), orgId); // esvazia o que os testes anteriores deixaram na fila
    calls.length = 0;
    const failedRow = (idempotencyKey: string, type: ActionType, payload: unknown, error: string, approvedBy?: string) =>
      db.insert(outboxActions).values({ orgId, type, target: "t", payload, idempotencyKey, state: "failed", attempts: 1, error, approvedBy: approvedBy ?? null }).returning();
    // Caminho próprio: no CI, outro pacote cria a nota do produto (processos/como-o-echo-funciona.md) em todas as empresas ao mesmo tempo.
    const [note] = await db.insert(brainNotes).values({ orgId, path: "processos/teste-sem-executor.md", kind: "processo", content: "Como funciona.", visibility: "team" }).returning();
    const [mirror] = await failedRow("sem-exec:mirror", "github.mirror_write", { repo: "org-teste/brains", noteId: note!.id, path: note!.path, content: "Como funciona.\n" }, noExecutorError("github.mirror_write"));
    const [assignPending] = await failedRow("sem-exec:assign", "linear.assign", { taskKey: "ECH-133", toPersonId: ids.car! }, noExecutorError("linear.assign"));
    const [assignApproved] = await failedRow("sem-exec:assign-ok", "linear.assign", { taskKey: "ECH-133", toPersonId: ids.car! }, noExecutorError("linear.assign"), ids.mar!);
    const [other] = await failedRow("sem-exec:outro", "slack.post", { channel: "C1", text: "x" }, "Slack fora do ar");
    // Mensagem de outro tipo não conta: só a do próprio tipo da ação.
    const [mismatch] = await failedRow("sem-exec:troca", "slack.post", { channel: "C1", text: "x" }, noExecutorError("github.mirror_write"));

    expect(await retryActionsWithoutExecutor(app)).toBeGreaterThanOrEqual(3);
    const get = async (id: string) => (await db.select().from(outboxActions).where(eq(outboxActions.id, id)))[0]!;
    expect(await get(mirror!.id)).toMatchObject({ state: "approved", attempts: 0, error: null });
    expect(await get(assignPending!.id)).toMatchObject({ state: "pending", attempts: 0, error: null });
    expect(await get(assignApproved!.id)).toMatchObject({ state: "approved", attempts: 0, error: null });
    expect(await get(other!.id)).toMatchObject({ state: "failed", attempts: 1, error: "Slack fora do ar" });
    expect((await get(mismatch!.id)).state).toBe("failed");
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, "requeue:linear.assign")));
    expect(audits.length).toBeGreaterThanOrEqual(2);

    expect(await drainActions(deps(), orgId)).toEqual({ done: 2, failed: 0, retried: 0 });
    expect(calls.sort()).toEqual(["github.put org-teste/brains/processos/teste-sem-executor.md", "linear.assign lin-133 → lin-carla"]);
    expect((await get(mirror!.id)).state).toBe("done");
    expect((await get(assignPending!.id)).state).toBe("pending");
    // Já recolocadas: rodar de novo não mexe em nada desta empresa.
    await retryActionsWithoutExecutor(app);
    expect((await get(other!.id)).state).toBe("failed");
  });

  it("com o Jira ligado, a tarefa vai para a conta da pessoa no Jira; sem conta lá, falha com motivo", async () => {
    // Empresa à parte que usa Jira em vez de Linear: o mesmo "linear.assign" vale para o tracker ligado.
    const [org] = await db.insert(orgs).values({ name: `Teste Jira ${Math.random().toString(36).slice(2, 7)}` }).returning();
    const o = org!.id;
    try {
      const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
      const [carla] = await db.insert(people).values({ orgId: o, name: "Carla", timezone: "America/Sao_Paulo", workHours: wh }).returning();
      const [yan] = await db.insert(people).values({ orgId: o, name: "Yan", timezone: "America/Sao_Paulo", workHours: wh }).returning();
      await db.insert(identities).values([
        { orgId: o, personId: carla!.id, platform: "jira", externalId: "acc-carla" },
        // Conta só no Linear não serve para tarefa do Jira.
        { orgId: o, personId: yan!.id, platform: "linear", externalId: "lin-yan" },
      ]);
      await db.insert(tasks).values({ orgId: o, key: "PAG-7", linearId: "10007", title: "Conciliação", state: "todo" });
      const jiraCalls: string[] = [];
      const jira: IssueWriter = {
        platform: "jira",
        assignIssue: async (issue, user) => void jiraCalls.push(`jira.assign ${issue} → ${user}`),
        comment: async (issue, body) => (jiraCalls.push(`jira.comment ${issue}: ${body}`), { id: "c1" }),
      };
      const jiraDeps = { db: app, writers: async () => ({ issues: jira }) };

      await enqueueAction(app, o, { type: "linear.assign", target: "jira:PAG-7", idempotencyKey: "jira:carla", payload: { taskKey: "PAG-7", toPersonId: carla!.id }, approvedBy: carla!.id });
      await enqueueAction(app, o, { type: "linear.comment", target: "jira:PAG-7", idempotencyKey: "jira:comentario", payload: { taskKey: "PAG-7", body: "Plano aprovado." }, approvedBy: carla!.id });
      await enqueueAction(app, o, { type: "linear.assign", target: "jira:PAG-7", idempotencyKey: "jira:yan", payload: { taskKey: "PAG-7", toPersonId: yan!.id }, approvedBy: carla!.id });
      expect(await drainActions(jiraDeps, o)).toMatchObject({ done: 2, failed: 1 });
      expect(jiraCalls.sort()).toEqual(["jira.assign 10007 → acc-carla", "jira.comment 10007: Plano aprovado."]);
      const [failed] = await db.select().from(outboxActions).where(and(eq(outboxActions.orgId, o), eq(outboxActions.idempotencyKey, "jira:yan")));
      expect(failed).toMatchObject({ state: "failed", error: "pessoa sem conta no Jira" });
    } finally {
      await db.delete(orgs).where(eq(orgs.id, o));
    }
  });

  it("depois da troca de tracker, a tarefa que ficou do outro não recebe escrita: o id do Jira não vai ao Linear, nem o contrário", async () => {
    // A tabela tasks não guarda a origem; a tarefa antiga fica aberta com a mesma chave. O id denuncia de onde veio.
    const [org] = await db.insert(orgs).values({ name: `Teste troca ${Math.random().toString(36).slice(2, 7)}` }).returning();
    const o = org!.id;
    try {
      const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
      const [carla] = await db.insert(people).values({ orgId: o, name: "Carla", timezone: "America/Sao_Paulo", workHours: wh }).returning();
      await db.insert(identities).values([
        { orgId: o, personId: carla!.id, platform: "linear", externalId: "lin-carla" },
        { orgId: o, personId: carla!.id, platform: "jira", externalId: "acc-carla" },
      ]);
      await db.insert(tasks).values([
        // Ficou do Jira (id só de números) e outra veio do Linear (UUID).
        { orgId: o, key: "PAG-7", linearId: "10007", title: "Conciliação", state: "todo" },
        { orgId: o, key: "ECH-9", linearId: "5b3f0c1e-2a4d-4f6e-9b8a-1c2d3e4f5a6b", title: "Estorno", state: "todo" },
      ]);
      const calls: string[] = [];
      const writer = (platform: "linear" | "jira"): IssueWriter => ({
        platform,
        assignIssue: async (issue, user) => void calls.push(`${platform}.assign ${issue} → ${user}`),
        comment: async (issue, body) => (calls.push(`${platform}.comment ${issue}: ${body}`), { id: "c1" }),
      });
      const key = (k: string) => db.select().from(outboxActions).where(and(eq(outboxActions.orgId, o), eq(outboxActions.idempotencyKey, k)));

      // Linear ligado: a tarefa do Jira falha com motivo e sem chamada; a do Linear segue.
      await enqueueAction(app, o, { type: "linear.assign", target: "linear:PAG-7", idempotencyKey: "lin:pag7", payload: { taskKey: "PAG-7", toPersonId: carla!.id }, approvedBy: carla!.id });
      await enqueueAction(app, o, { type: "linear.comment", target: "linear:PAG-7", idempotencyKey: "lin:pag7:c", payload: { taskKey: "PAG-7", body: "oi" }, approvedBy: carla!.id });
      await enqueueAction(app, o, { type: "linear.assign", target: "linear:ECH-9", idempotencyKey: "lin:ech9", payload: { taskKey: "ECH-9", toPersonId: carla!.id }, approvedBy: carla!.id });
      expect(await drainActions({ db: app, writers: async () => ({ issues: writer("linear") }) }, o)).toMatchObject({ done: 1, failed: 2 });
      expect(calls).toEqual(["linear.assign 5b3f0c1e-2a4d-4f6e-9b8a-1c2d3e4f5a6b → lin-carla"]);
      expect((await key("lin:pag7"))[0]).toMatchObject({ state: "failed", error: "tarefa PAG-7 é do Jira, e o tracker ligado é o Linear" });
      expect((await key("lin:pag7:c"))[0]).toMatchObject({ state: "failed", error: "tarefa PAG-7 é do Jira, e o tracker ligado é o Linear" });

      // Jira ligado: a tarefa do Linear falha do mesmo jeito.
      calls.length = 0;
      await enqueueAction(app, o, { type: "linear.assign", target: "jira:ECH-9", idempotencyKey: "jira:ech9", payload: { taskKey: "ECH-9", toPersonId: carla!.id }, approvedBy: carla!.id });
      expect(await drainActions({ db: app, writers: async () => ({ issues: writer("jira") }) }, o)).toMatchObject({ done: 0, failed: 1 });
      expect(calls).toEqual([]);
      expect((await key("jira:ech9"))[0]).toMatchObject({ state: "failed", error: "tarefa ECH-9 é do Linear, e o tracker ligado é o Jira" });
    } finally {
      await db.delete(orgs).where(eq(orgs.id, o));
    }
  });

  it("EXECUTABLE_TYPES é exatamente a lista de casos do executor", async () => {
    // Empresa à parte, sem plataformas ligadas: cada ação falha, mas só as sem caso no switch caem no default.
    const [org] = await db.insert(orgs).values({ name: `Teste tipos ${Math.random().toString(36).slice(2, 7)}` }).returning();
    try {
      const types = Object.keys(REQUIRES_APPROVAL) as ActionType[];
      for (const type of types) await db.insert(outboxActions).values({ orgId: org!.id, type, target: "t", payload: {}, idempotencyKey: `tipo:${type}`, state: "approved" });
      await drainActions({ db: app, writers: async () => ({}) }, org!.id);
      const rows = await db.select().from(outboxActions).where(eq(outboxActions.orgId, org!.id));
      const withoutExecutor = rows.filter((r) => r.error === noExecutorError(r.type)).map((r) => r.type);
      expect(rows.every((r) => r.error)).toBe(true);
      expect(withoutExecutor.sort()).toEqual(types.filter((t) => !EXECUTABLE_TYPES.includes(t)).sort());
      expect([...EXECUTABLE_TYPES].sort()).toEqual([...new Set(EXECUTABLE_TYPES)].filter((t) => types.includes(t)).sort());
    } finally {
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    }
  });
});
