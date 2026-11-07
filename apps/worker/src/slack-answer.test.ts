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
  const chat = {
    getPresence: async () => presence,
    postEphemeral: async (_c: string, _u: string, t: string) => void ephemeral.push(t),
    postAgentReply: async (i: (typeof posted)[number]) => (posted.push(i), { ts: "9.9" }),
    sendDm: async () => {},
  } as unknown as ChatPlatform;
  return { chat, posted, ephemeral };
}

const answered: AnswerResult = {
  agentName: "Agente de Fernando",
  text: "Sim, para ech-131-api-v2: Fernando deixou essa branch liberada na nota do dia confirmada. Fernando volta às 9h, horário de Fortaleza.",
  sources: [{ ref: "daily_note:x", label: "nota do dia de Fernando (confirmada)" }],
  needsOwner: false,
  usedModel: true,
  warnings: [],
  ownerReturnsAt: new Date("2026-11-06T12:00:00Z"),
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

  it("dono ausente: 'consultando' só para quem chamou, resposta no tópico como agente, com fontes e botões", async () => {
    const { chat, posted, ephemeral } = fakeChat("away");
    const m = msg();
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w" }, { orgId, message: m })).toBe("answered");
    expect(ephemeral).toEqual(["Agente de Fernando consultando…"]);
    expect(seen.at(-1)).toMatchObject({ text: "@Fernando posso seguir com a branch ech-131-api-v2?", ownerId: ids.fer });
    expect(posted[0]).toMatchObject({ channel: "C1", threadTs: m.ts, agentName: "Agente de Fernando" });
    const [q] = await db.select().from(questions).where(eq(questions.orgId, orgId));
    expect(q).toMatchObject({ state: "answered", askerId: ids.edu, ownerId: ids.fer, kind: "gemeo", sourceRef: `slack:C1:${m.ts}` });
    expect(q!.textExpiresAt).not.toBeNull();
    expect(JSON.stringify(posted[0]!.blocks)).toContain(q!.id); // botões Resolveu / Não resolveu
    expect(JSON.stringify(posted[0]!.blocks)).toContain("Fontes: nota do dia de Fernando (confirmada)");

    // Reenvio do mesmo aviso: não publica de novo.
    expect(await handleSlackMessage({ db: app, chat, answer, log, workerId: "w" }, { orgId, message: m })).toBe("duplicate");
    expect(posted).toHaveLength(1);
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

  it("Resolveu: só quem perguntou registra; a resposta vai pelo response_url", async () => {
    const [q] = await db.select().from(questions).where(and(eq(questions.orgId, orgId), eq(questions.state, "answered"))).limit(1);
    const said: string[] = [];
    const respond = async (_u: string, b: object) => void said.push((b as { text: string }).text);
    const click = (user: string) => ({ orgId, payload: { user: { id: user }, response_url: "https://hooks.slack.com/actions/x", actions: [{ action_id: "answer_helpful", value: q!.id }] } });
    expect(await handleSlackInteraction({ db: app, log, respond }, click("UFER"))).toBe("not_asker");
    expect(await handleSlackInteraction({ db: app, log, respond }, click("UEDU"))).toBe("recorded");
    expect(said).toEqual(["Só quem perguntou pode avaliar esta resposta.", "Avaliação registrada. Obrigado."]);
    const [after] = await db.select().from(questions).where(eq(questions.id, q!.id));
    expect(after!.resolved).toBe(true);
  });
});
