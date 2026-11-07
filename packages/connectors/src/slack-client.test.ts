import { describe, expect, it } from "vitest";
import { answerBlocks, dailyNoteDraftBlocks, fitText, respondToInteraction, SLACK_ACTIONS, SlackApiError, SlackChat } from "./slack-client.ts";

type Call = { url: string; body: any; auth: string | null };

/** Slack falso: responde por método e registra as chamadas. */
function fakeSlack(handlers: Record<string, (body: any) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const method = url.split("/").pop()!;
    const body = JSON.parse(String(init.body ?? "{}"));
    calls.push({ url, body, auth: new Headers(init.headers).get("authorization") });
    const h = handlers[method];
    if (!h) return Response.json({ ok: false, error: "unknown_method" });
    return h(body);
  };
  return { calls, chat: new SlackChat({ token: "xoxb-teste", fetch, sleep: async () => {} }) };
}

describe("getPresence", () => {
  it("lê o status com o token do bot", async () => {
    const { chat, calls } = fakeSlack({ "users.getPresence": () => Response.json({ ok: true, presence: "away" }) });
    expect(await chat.getPresence("UFER")).toBe("away");
    expect(calls[0]).toMatchObject({ body: { user: "UFER" }, auth: "Bearer xoxb-teste" });
  });

  it("erro, resposta estranha ou demora viram unknown (reserva: isAway)", async () => {
    expect(await fakeSlack({ "users.getPresence": () => Response.json({ ok: false, error: "user_not_found" }) }).chat.getPresence("U1")).toBe("unknown");
    expect(await fakeSlack({ "users.getPresence": () => Response.json({ ok: true, presence: "??" }) }).chat.getPresence("U1")).toBe("unknown");
    const slow = new SlackChat({
      token: "x",
      fetch: (_u, init) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("abortado")))),
    });
    const t0 = Date.now();
    expect(await slow.getPresence("U1", 50)).toBe("unknown");
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe("postAgentReply", () => {
  it("responde identificado como agente, no tópico, sem prévia de links", async () => {
    const { chat, calls } = fakeSlack({ "chat.postMessage": () => Response.json({ ok: true, ts: "99.1" }) });
    const blocks = answerBlocks({ text: "Sim, para `ech-131-api-v2`…", sources: [{ label: "nota do dia de Fernando (confirmada)" }], questionId: "q1" });
    const res = await chat.postAgentReply({ channel: "C1", threadTs: "1.1", agentName: "Agente de Fernando", text: "Sim…", blocks });
    expect(res).toEqual({ ts: "99.1" });
    expect(calls[0]!.body).toMatchObject({ channel: "C1", thread_ts: "1.1", username: "Agente de Fernando", unfurl_links: false, unfurl_media: false });
  });

  it("tenta de novo uma vez quando o Slack pede para esperar (429)", async () => {
    let n = 0;
    const { chat, calls } = fakeSlack({
      "chat.postMessage": () => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "1" } }) : Response.json({ ok: true, ts: "1.0" })),
    });
    await chat.postAgentReply({ channel: "C1", agentName: "Agente de Yan", text: "oi" });
    expect(calls).toHaveLength(2);
  });

  it("erro do Slack vira SlackApiError com o código", async () => {
    const { chat } = fakeSlack({ "chat.postMessage": () => Response.json({ ok: false, error: "not_in_channel" }) });
    await expect(chat.postAgentReply({ channel: "C1", agentName: "Echo", text: "x" })).rejects.toMatchObject({ name: "SlackApiError", code: "not_in_channel" });
    expect(new SlackApiError("m", "c")).toBeInstanceOf(Error);
  });
});

describe("mensagens privadas e efêmeras", () => {
  it("DM vai para o id da pessoa; efêmera só para quem chamou", async () => {
    const { chat, calls } = fakeSlack({ "chat.postMessage": () => Response.json({ ok: true, ts: "1" }), "chat.postEphemeral": () => Response.json({ ok: true }) });
    await chat.sendDm("UFER", { text: "Rascunho da sua nota de hoje.", blocks: dailyNoteDraftBlocks({ text: "Parou em: ECH-128", noteId: "n1", panelUrl: "https://painel" }) });
    await chat.postEphemeral("C1", "UEDU", "Agente de Fernando consultando…");
    expect(calls[0]!.body).toMatchObject({ channel: "UFER" });
    expect(calls[0]!.body.blocks[1].elements.map((e: any) => e.action_id)).toEqual([SLACK_ACTIONS.confirmDailyNote, SLACK_ACTIONS.editDailyNote]);
    expect(calls[1]!.body).toEqual({ channel: "C1", user: "UEDU", text: "Agente de Fernando consultando…" });
  });

  it("aviso 'consultando' é mensagem comum no tópico, com o nome do agente, e pode ser apagado", async () => {
    const { chat, calls } = fakeSlack({ "chat.postMessage": () => Response.json({ ok: true, channel: "C1", ts: "5.5" }), "chat.delete": () => Response.json({ ok: true }) });
    const notice = await chat.postNotice({ channel: "C1", threadTs: "1.1", agentName: "Agente de Fernando", text: "_Agente de Fernando consultando os registros…_" });
    expect(notice).toEqual({ channel: "C1", ts: "5.5" });
    expect(calls[0]!.body).toMatchObject({ channel: "C1", thread_ts: "1.1", username: "Agente de Fernando" });
    await chat.deleteMessage(notice!.channel, notice!.ts);
    expect(calls[1]!.body).toEqual({ channel: "C1", ts: "5.5" });
  });
});

describe("blocos e limites", () => {
  it("resposta com fontes e botões; sem pergunta registrada, sem botões", () => {
    const b = answerBlocks({ text: "ok", sources: [{ label: "ECH-140 no Linear" }, { label: "PR 42" }], questionId: "q9" })!;
    expect(b).toHaveLength(3);
    expect(JSON.stringify(b[1])).toContain("Fontes: ECH-140 no Linear · PR 42");
    expect((b[2] as any).elements.map((e: any) => e.value)).toEqual(["q9", "q9"]);
    expect(answerBlocks({ text: "ok", sources: [] })).toHaveLength(1);
  });

  it("texto longo sai sem blocos e cortado com aviso", () => {
    expect(answerBlocks({ text: "x".repeat(3001), sources: [] })).toBeUndefined();
    const cut = fitText("y".repeat(5000));
    expect(cut.length).toBe(4000);
    expect(cut.endsWith("(continua no painel)")).toBe(true);
  });
});

describe("authTest, listUsers e response_url", () => {
  it("identidade do bot e lista sem bots, paginada", async () => {
    const { chat } = fakeSlack({
      "auth.test": () => Response.json({ ok: true, user_id: "UBOT", team_id: "T-DEMO", bot_id: "B1" }),
      "users.list": (b) =>
        Response.json(
          b.cursor
            ? { ok: true, members: [{ id: "UCAR", profile: { real_name: "Carla" }, tz: "America/Sao_Paulo" }] }
            : { ok: true, members: [{ id: "UFER", profile: { real_name: "Fernando" } }, { id: "UB", is_bot: true }, { id: "USLACKBOT" }], response_metadata: { next_cursor: "c2" } },
        ),
    });
    expect(await chat.authTest()).toEqual({ userId: "UBOT", teamId: "T-DEMO", botId: "B1" });
    expect(await chat.listUsers()).toEqual([{ id: "UFER", name: "Fernando" }, { id: "UCAR", name: "Carla", tz: "America/Sao_Paulo" }]);
  });

  it("response_url só no domínio do Slack", async () => {
    let posted = "";
    await respondToInteraction("https://hooks.slack.com/actions/T/1/x", { text: "Nota confirmada." }, async (_u, i) => ((posted = String(i.body)), new Response("ok")));
    expect(posted).toContain("Nota confirmada.");
    await expect(respondToInteraction("https://evil.example/x", {})).rejects.toThrow(/domínio/);
  });
});
