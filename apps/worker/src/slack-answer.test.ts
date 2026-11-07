import type { AnswerResult } from "@echo/agents";
import type { ChatMessage, ChatPlatform, Presence } from "@echo/connectors";
import { createDb, createPool, identities, orgs, people, questions } from "@echo/db";
import { appRoleUrl } from "@echo/db/testing";
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleSlackInteraction, handleSlackMessage } from "./slack-answer.ts";

const url = process.env.DATABASE_URL;
const log = pino({ level: "silent" });

function fakeChat(presence: Presence) {
  const posted: { channel: string; threadTs?: string; agentName: string; text: string; blocks?: unknown[] }[] = [];
  const ephemeral: string[] = [];
  const notices: { channel: string; threadTs?: string; agentName: string; text: string }[] = [];
  const deleted: string[] = [];
  // Ordem dos passos no Slack, para conferir que o aviso só sai depois da resposta.
  const steps: string[] = [];
  const chat = {
    getPresence: async () => presence,
    postEphemeral: async (_c: string, _u: string, t: string) => void ephemeral.push(t),
    postNotice: async (i: (typeof notices)[number]) => (notices.push(i), steps.push("aviso"), { channel: i.channel, ts: `n.${notices.length}` }),
    deleteMessage: async (_c: string, ts: string) => void (deleted.push(ts), steps.push("apaga")),
    postAgentReply: async (i: (typeof posted)[number]) => (posted.push(i), steps.push("resposta"), { ts: "9.9" }),
    sendDm: async () => {},
  } as unknown as ChatPlatform;
  return { chat, posted, ephemeral, notices, deleted, steps };
}

const answered: AnswerResult = {
  agentName: "Agente de Fernando",
  text: "Sim, para ech-131-api-v2: Fernando deixou essa branch liberada na nota do dia confirmada. Fernando volta às 9h, horário de Fortaleza.",
  sources: [{ ref: "daily_note:x", label: "nota do dia de Fernando (confirmada)" }],
  needsOwner: false,
  usedModel: true,
  warnings: [],
  ownerReturnsAt: new Date("2026-11-06T12:00:00Z"),
  digest: { kind: "nenhum", request: "@Fernando posso seguir com a branch ech-131-api-v2?", reply: "Sim, para ech-131-api-v2: Fernando deixou essa branch liberada na nota do dia confirmada." },
};

describe.skipIf(!url)("F2 no Slack (Postgres real, papel comum)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  let appPool: ReturnType<typeof createPool>;
  let app: ReturnType<typeof createDb>;
  let orgId = "";
  const ids: Record<string, string> = {};
  const seen: { text: string; ownerId?: string }[] = [];
  const answer = async (req: { text: string; ownerId?: string }) => (seen.push(req), answered);

  beforeAll(async () => {
    appPool = createPool(await appRoleUrl(pool, url!), 2, { defaultScope: "none" });
    app = createDb(appPool);
    const [org] = await db.insert(orgs).values({ name: `Teste F2 ${Math.random().toString(36).slice(2, 7)}` }).returning();
    orgId = org!.id;
    const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    for (const [k, name, slack] of [["fer", "Fernando", "UFER"], ["edu", "Eduardo", "UEDU"]] as const) {
      const [p] = await db.insert(people).values({ orgId, name, timezone: "America/Fortaleza", workHours: wh }).returning();
      ids[k] = p!.id;
      await db.insert(identities).values({ orgId, personId: p!.id, platform: "slack", externalId: slack });
    }
  });
  afterAll(async () => {
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await Promise.all([pool.end(), appPool.end()]);
  });

  const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({ channel: "C1", ts: `1.${Math.random().toString().slice(2, 8)}`, userExternalId: "UEDU", text: "<@UFER> posso seguir com a branch ech-131-api-v2?", mentions: ["UFER"], mentionsBot: false, isDm: false, ...over });

  it("dono ativo no Slack: silêncio, sem gravar pergunta", async () => {
    const { chat, posted } = fakeChat("active");
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w" }, { orgId, message: msg() })).toBe("silent");
    expect(posted).toHaveLength(0);
    expect(await db.select().from(questions).where(eq(questions.orgId, orgId))).toHaveLength(0);
  });

  it("dono ausente: 'consultando' temporário no tópico, resposta como agente, com fontes e botões", async () => {
    const { chat, posted, ephemeral, notices, deleted, steps } = fakeChat("away");
    const m = msg();
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w" }, { orgId, message: m })).toBe("answered");
    expect(notices).toEqual([{ channel: "C1", threadTs: m.ts, agentName: "Agente de Fernando", text: "_Agente de Fernando consultando os registros…_" }]);
    expect(steps).toEqual(["aviso", "resposta", "apaga"]);
    expect(deleted).toEqual(["n.1"]);
    expect(ephemeral).toEqual([]);
    expect(seen.at(-1)).toMatchObject({ text: "@Fernando posso seguir com a branch ech-131-api-v2?", ownerId: ids.fer });
    expect(posted[0]).toMatchObject({ channel: "C1", threadTs: m.ts, agentName: "Agente de Fernando" });
    const [q] = await db.select().from(questions).where(eq(questions.orgId, orgId));
    expect(q).toMatchObject({ state: "answered", askerId: ids.edu, ownerId: ids.fer, kind: "gemeo", sourceRef: `slack:C1:${m.ts}` });
    expect(q!.textExpiresAt).not.toBeNull();
    // Resumo da ausência: tipo e as duas linhas, sem a menção ao próprio dono; volta gravada para os Ganhos.
    expect(q).toMatchObject({ digestKind: "nenhum", digestRequest: "posso seguir com a branch ech-131-api-v2?", digestReply: answered.digest!.reply, digestedAt: null });
    expect(q!.ownerReturnsAt).toEqual(answered.ownerReturnsAt);
    expect(q!.answeredAt).not.toBeNull();
    expect(JSON.stringify(posted[0]!.blocks)).toContain(q!.id); // botões Resolveu / Não resolveu
    expect(JSON.stringify(posted[0]!.blocks)).toContain("Fontes: nota do dia de Fernando (confirmada)");

    // Reenvio do mesmo aviso: não publica de novo.
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w" }, { orgId, message: m })).toBe("duplicate");
    expect(posted).toHaveLength(1);
  });

  it("ensaio de dia (DEMO_ALWAYS_AWAY): responde mesmo com o dono ativo, sem consultar o status", async () => {
    let asked = false;
    const { chat, posted } = fakeChat("active");
    (chat as unknown as { getPresence: () => Promise<Presence> }).getPresence = async () => ((asked = true), "active");
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w", alwaysAway: true }, { orgId, message: msg({ channel: "C9" }) })).toBe("answered");
    expect(asked).toBe(false);
    expect(posted).toHaveLength(1);
  });

  it("falha na resposta: o aviso 'consultando' também é apagado", async () => {
    const { chat, deleted } = fakeChat("away");
    const boom = async () => {
      throw new Error("modelo fora");
    };
    await expect(handleSlackMessage({ db: app, chat, answer: boom, log, workerId: "w" }, { orgId, message: msg({ channel: "C10" }) })).rejects.toThrow("modelo fora");
    expect(deleted).toEqual(["n.1"]);
  });

  it("acima do dobro do limite: a resposta por regra sai no tópico, mas fica como falha e não volta a sair", async () => {
    const { chat, posted } = fakeChat("away");
    const m = msg({ channel: "C7" });
    const over = async () => ({ ...answered, usedModel: false, ownerReturnsAt: undefined, overLimit: true as const });
    expect(await handleSlackMessage({ db: app, chat, answer: over, log, workerId: "w" }, { orgId, message: m })).toBe("answered");
    expect(posted).toHaveLength(1);
    const [q] = await db.select().from(questions).where(and(eq(questions.orgId, orgId), eq(questions.sourceRef, `slack:C7:${m.ts}`)));
    expect(q).toMatchObject({ state: "failed", ownerReturnsAt: null, answer: answered.text });
    // Reenvio do aviso: a falha já respondida não é retomada.
    expect(await handleSlackMessage({ db: app, chat, answer: over, log, workerId: "w" }, { orgId, message: m })).toBe("duplicate");
    expect(posted).toHaveLength(1);
  });

  it("proposta citando o dono só pelo nome: sem resposta nem status, mas entra no resumo se ele está fora", async () => {
    let asked = false;
    const { chat, posted } = fakeChat("active");
    (chat as unknown as { getPresence: () => Promise<Presence> }).getPresence = async () => ((asked = true), "active");
    const deps = (iso: string) => ({ db: app, chat, answer, log, workerId: "w", now: () => new Date(iso) });
    const proposta = (ts: string, text = "Que tal o Fernando revisar a API amanhã?") => msg({ channel: "C8", ts, text, mentions: [] });

    // Sábado: Fernando fora pelo expediente cadastrado.
    expect(await handleSlackMessage(deps("2026-11-07T15:00:00Z"), { orgId, message: proposta("8.1") })).toBe("noted");
    expect(await handleSlackMessage(deps("2026-11-07T15:00:00Z"), { orgId, message: proposta("8.1") })).toBe("duplicate");
    // Segunda ao meio-dia em Fortaleza: no expediente, nada fica.
    expect(await handleSlackMessage(deps("2026-11-09T15:00:00Z"), { orgId, message: proposta("8.2") })).toBe("skipped");
    // Não é proposta: nada fica.
    expect(await handleSlackMessage(deps("2026-11-07T15:00:00Z"), { orgId, message: proposta("8.3", "o Fernando terminou a API") })).toBe("skipped");
    expect(posted).toHaveLength(0);
    expect(asked).toBe(false);

    const rows = await db.select().from(questions).where(and(eq(questions.orgId, orgId), eq(questions.channel, "slack:C8")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "citacao", state: "silent", askerId: ids.edu, ownerId: ids.fer, needsOwner: true, digestKind: "proposta", digestRequest: "Que tal o Fernando revisar a API amanhã?", answer: null, ownerReturnsAt: null });
  });

  it("pergunta direta ao bot não consulta o status; quem não está cadastrado é ignorado", async () => {
    let asked = false;
    const { chat } = fakeChat("active");
    (chat as unknown as { getPresence: () => Promise<Presence> }).getPresence = async () => ((asked = true), "active");
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w" }, { orgId, message: msg({ mentionsBot: true, text: "<@UBOT> o que o <@UFER> fez?" }) })).toBe("answered");
    expect(asked).toBe(false);
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w" }, { orgId, message: msg({ userExternalId: "UESTRANHO" }) })).toBe("skipped");
  });

  it("Slack sem status: vale o expediente cadastrado (no expediente = silêncio; fora = responde)", async () => {
    const { chat, posted } = fakeChat("unknown");
    // Sexta 14h em Fortaleza: no expediente.
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w", now: () => new Date("2026-11-06T17:00:00Z") }, { orgId, message: msg() })).toBe("silent");
    // Sexta 3h em Fortaleza: fora do expediente.
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w", now: () => new Date("2026-11-06T06:12:00Z") }, { orgId, message: msg() })).toBe("answered");
    expect(posted).toHaveLength(1);
  });

  it("Resolveu: só quem perguntou avalia, uma vez só, e os botões saem da mensagem", async () => {
    const [q] = await db.select().from(questions).where(and(eq(questions.orgId, orgId), eq(questions.state, "answered"))).limit(1);
    const said: Record<string, unknown>[] = [];
    const respond = async (_u: string, b: object) => void said.push(b as Record<string, unknown>);
    const message = {
      text: "resposta",
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "resposta" } },
        { type: "actions", elements: [] },
      ],
    };
    const click = (user: string, action_id = "answer_helpful") => ({ orgId, payload: { user: { id: user }, response_url: "https://hooks.slack.com/actions/x", message, actions: [{ action_id, value: q!.id }] } });

    expect(await handleSlackInteraction({ db: app, log, respond }, click("UFER"))).toBe("not_asker");
    expect(said[0]).toMatchObject({ replace_original: false, response_type: "ephemeral", text: "Só quem perguntou pode avaliar esta resposta." });

    expect(await handleSlackInteraction({ db: app, log, respond }, click("UEDU"))).toBe("recorded");
    expect(said[1]).toMatchObject({ replace_original: true, text: "resposta" });
    const blocks = (said[1] as { blocks: { type: string }[] }).blocks;
    expect(blocks.map((b) => b.type)).toEqual(["section", "context"]);
    expect(JSON.stringify(blocks)).toContain("Avaliada por quem perguntou: *Resolveu*");

    // Segundo clique (botão ainda na tela de outro aparelho): não troca a avaliação.
    expect(await handleSlackInteraction({ db: app, log, respond }, click("UEDU", "answer_not_helpful"))).toBe("already_rated");
    expect(JSON.stringify(said[2])).toContain("*Resolveu*");
    const [after] = await db.select().from(questions).where(eq(questions.id, q!.id));
    expect(after!.resolved).toBe(true);
  });
});

describe("roteador de cliques", () => {
  it("entrega cada clique a todos os tratadores; a falha de um não impede os outros e sobe para a fila", async () => {
    const { createInteractionRouter } = await import("./slack-interactions.ts");
    const r = createInteractionRouter(log);
    const got: string[] = [];
    r.add("resolveu", async () => void got.push("resolveu"));
    r.add("quebrado", async () => Promise.reject(new Error("boom")));
    r.add("nota", async () => void got.push("nota"));
    await expect(r.dispatch({ orgId: "o", payload: {} })).rejects.toThrow("boom");
    expect(got).toEqual(["resolveu", "nota"]);
  });
});

describe.skipIf(!url)("perguntas paradas há mais de 1 hora", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  let orgId = "";
  let edu = "";
  afterAll(async () => {
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
    await pool.end();
  });

  it("viram falha, quem perguntou é avisado uma vez, e a pergunta não volta a ser respondida", async () => {
    const [org] = await db.insert(orgs).values({ name: `Teste paradas ${Math.random().toString(36).slice(2, 7)}` }).returning();
    orgId = org!.id;
    const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    const [e] = await db.insert(people).values({ orgId, name: "Eduardo", timezone: "Africa/Johannesburg", workHours: wh }).returning();
    const [f] = await db.insert(people).values({ orgId, name: "Fernando", timezone: "America/Fortaleza", workHours: wh }).returning();
    edu = e!.id;
    await db.insert(identities).values([
      { orgId, personId: edu, platform: "slack", externalId: "UEDU2" },
      { orgId, personId: f!.id, platform: "slack", externalId: "UFER2" },
    ]);
    const old = new Date(Date.now() - 2 * 3_600_000);
    await db.insert(questions).values([
      { orgId, askerId: edu, ownerId: f!.id, kind: "gemeo", channel: "slack:C9", sourceRef: "slack:C9:1.1", state: "processing", createdAt: old },
      { orgId, askerId: edu, kind: "livre", channel: "slack:C9", sourceRef: "slack:C9:1.2", state: "processing" }, // recente: ainda não
    ]);
    const { chat, ephemeral } = fakeChat("away");
    const { giveUpStaleQuestions } = await import("./slack-answer.ts");
    expect(await giveUpStaleQuestions({ db, chat, log })).toBe(1);
    expect(ephemeral).toEqual(["O Echo não conseguiu responder a sua pergunta a tempo. Fale direto com Fernando."]);
    expect(await giveUpStaleQuestions({ db, chat, log })).toBe(0); // não repete o aviso
    const [q] = await db.select().from(questions).where(eq(questions.sourceRef, "slack:C9:1.1"));
    expect(q).toMatchObject({ state: "failed", digestKind: "falha_avisada" });

    // Uma nova tentativa da fila para a mesma mensagem não responde mais.
    const answer = async () => answered;
    const msg: ChatMessage = { channel: "C9", ts: "1.1", userExternalId: "UEDU2", text: "<@UFER2> oi?", mentions: ["UFER2"], mentionsBot: false, isDm: false };
    expect(await handleSlackMessage({ db, chat, answer, log, workerId: "w" }, { orgId, message: msg })).toBe("duplicate");
  });
});
