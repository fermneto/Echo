import { describe, expect, it } from "vitest";
import { answerBlocks, dailyNoteDraftBlocks, fitText, respondToInteraction, SLACK_ACTIONS, SlackApiError, SlackChat, toMrkdwn } from "./slack-client.ts";

type Call = { url: string; body: any; auth: string | null; form: boolean };

/** Slack falso: responde por método e registra as chamadas (corpo JSON ou formulário). */
function fakeSlack(handlers: Record<string, (body: any) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const method = url.split("/").pop()!;
    const form = (new Headers(init.headers).get("content-type") ?? "").startsWith("application/x-www-form-urlencoded");
    const body = form ? Object.fromEntries(new URLSearchParams(String(init.body ?? ""))) : JSON.parse(String(init.body ?? "{}"));
    calls.push({ url, body, auth: new Headers(init.headers).get("authorization"), form });
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

  it("vai como formulário: com corpo JSON o Slack ignora o user e devolve o status do próprio bot", async () => {
    const { chat, calls } = fakeSlack({ "users.getPresence": () => Response.json({ ok: true, presence: "away" }) });
    await chat.getPresence("UYAN");
    expect(calls[0]).toMatchObject({ form: true, body: { user: "UYAN" } });
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

describe("formato da resposta", () => {
  it("converte Markdown comum para o Slack sem tocar em código", () => {
    expect(toMrkdwn("## **Estado**\n- item **forte**\n- [PR](https://x.y/1)\nveja `**cru**` - fim\n```\n# fica\n```")).toBe("*Estado*\n• item *forte*\n• <https://x.y/1|PR>\nveja `**cru**` - fim\n```\n# fica\n```");
  });

  it("avisos e autoria ficam no rodapé, com fontes", () => {
    const blocks = answerBlocks({ text: "Sim.", warnings: ["dado antigo"], agentName: "Agente de Fernando", sources: [{ label: "nota do dia" }] }) as { type: string; elements?: { text: string }[] }[];
    expect(blocks.map((b) => b.type)).toEqual(["section", "context", "context"]);
    expect(blocks[1]!.elements![0]!.text).toBe(":large_yellow_circle: Aviso: dado antigo");
    expect(blocks[2]!.elements![0]!.text).toBe(":large_blue_circle: Agente de Fernando · Fontes: nota do dia");
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

describe("answerBlocks no idioma da conversa", () => {
  it("fontes e botões em inglês e espanhol; português por padrão", () => {
    const en = JSON.stringify(answerBlocks({ text: "ok", sources: [{ label: "PR 42" }], questionId: "q1", lang: "en" }));
    expect(en).toContain("Sources: PR 42");
    expect(en).toContain("Solved it");
    expect(en).toContain("Didn't solve it");
    const es = JSON.stringify(answerBlocks({ text: "ok", sources: [{ label: "PR 42" }], questionId: "q1", lang: "es" }));
    expect(es).toContain("Fuentes: PR 42");
    expect(es).toContain("No lo resolvió");
    expect(JSON.stringify(answerBlocks({ text: "ok", sources: [{ label: "PR 42" }], questionId: "q1" }))).toContain("Não resolveu");
  });
});

describe("sendDmFile", () => {
  it("abre a conversa, pede a URL, envia os bytes e completa o upload na conversa privada, com comentário", async () => {
    const seen: { url: string; ct: string; body: unknown }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      const ct = new Headers(init.headers).get("content-type") ?? "";
      const body = ct.startsWith("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(String(init.body))) : ct.startsWith("application/json") ? JSON.parse(String(init.body)) : (init.body as Uint8Array).byteLength;
      seen.push({ url, ct, body });
      if (url.endsWith("/conversations.open")) return Response.json({ ok: true, channel: { id: "DYAN" } });
      if (url.endsWith("/files.getUploadURLExternal")) return Response.json({ ok: true, upload_url: "https://files.slack.test/upload/v1/abc", file_id: "F1" });
      if (url.startsWith("https://files.slack.test/")) return new Response("OK - 4");
      if (url.endsWith("/files.completeUploadExternal")) return Response.json({ ok: true, files: [{ id: "F1" }] });
      return Response.json({ ok: false, error: "unknown_method" });
    };
    const chat = new SlackChat({ token: "xoxb-teste", fetch, sleep: async () => {} });
    await chat.sendDmFile("UYAN", { filename: "resumo.png", data: new Uint8Array([1, 2, 3, 4]), title: "Resumo do dia, 07/11", comment: "Resumo do seu dia", altText: "Resumo" });
    expect(seen.map((s) => s.url.split("/").pop())).toEqual(["conversations.open", "files.getUploadURLExternal", "abc", "files.completeUploadExternal"]);
    expect(seen[0]!.body).toEqual({ users: "UYAN" });
    expect(seen[1]).toMatchObject({ ct: "application/x-www-form-urlencoded", body: { filename: "resumo.png", length: "4", alt_txt: "Resumo" } });
    expect(seen[2]).toMatchObject({ ct: "application/octet-stream", body: 4 });
    expect(seen[3]).toMatchObject({ ct: "application/x-www-form-urlencoded", body: { channel_id: "DYAN", initial_comment: "Resumo do seu dia" } });
    expect(JSON.parse((seen[3]!.body as { files: string }).files)).toEqual([{ id: "F1", title: "Resumo do dia, 07/11" }]);
  });

  it("no canal: sem abrir conversa, completa o upload no canal; fora do canal, o not_in_channel sobe", async () => {
    const seen: { url: string; body: Record<string, string> | number }[] = [];
    let member = true;
    const fetch = async (url: string, init: RequestInit) => {
      const ct = new Headers(init.headers).get("content-type") ?? "";
      seen.push({ url, body: ct.startsWith("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(String(init.body))) : (init.body as Uint8Array).byteLength });
      if (url.endsWith("/files.getUploadURLExternal")) return Response.json({ ok: true, upload_url: "https://files.slack.test/upload/v1/vid", file_id: "F2" });
      if (url.startsWith("https://files.slack.test/")) return new Response("OK");
      if (url.endsWith("/files.completeUploadExternal")) return Response.json(member ? { ok: true } : { ok: false, error: "not_in_channel" });
      return Response.json({ ok: false, error: "unknown_method" });
    };
    const chat = new SlackChat({ token: "xoxb-teste", fetch, sleep: async () => {} });
    await chat.sendChannelFile("C0PRODUTO1", { filename: "video.mp4", data: new Uint8Array([0, 0, 0, 24]), title: "Vídeo da semana", comment: "Comentem aqui na thread." });
    expect(seen.map((s) => s.url.split("/").pop())).toEqual(["files.getUploadURLExternal", "vid", "files.completeUploadExternal"]);
    expect(seen[2]!.body).toMatchObject({ channel_id: "C0PRODUTO1", initial_comment: "Comentem aqui na thread." });
    member = false;
    await expect(chat.sendChannelFile("C0OUTRO001", { filename: "video.mp4", data: new Uint8Array([1]), title: "t", comment: "c" })).rejects.toMatchObject({ code: "not_in_channel" });
  });

  it("sem files:write, o erro do Slack sobe com o código (o executor manda a versão em texto)", async () => {
    const fetch = async (url: string) => (url.endsWith("/conversations.open") ? Response.json({ ok: true, channel: { id: "D1" } }) : Response.json({ ok: false, error: "missing_scope" }));
    const chat = new SlackChat({ token: "xoxb-teste", fetch, sleep: async () => {} });
    await expect(chat.sendDmFile("U1", { filename: "a.png", data: new Uint8Array([1]), title: "t", comment: "c" })).rejects.toMatchObject({ code: "missing_scope" });
  });
});
