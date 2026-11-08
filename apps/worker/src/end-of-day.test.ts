import { InMemoryQueue, QUEUES } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerEndOfDay, type DailyNoteJob, type EndOfDayWiring } from "./end-of-day.ts";

describe("registerEndOfDay", () => {
  it("agenda → rascunho → prazo de 2 h; repetir a agenda não duplica; Confirmar chega ao fluxo", async () => {
    const queue = new InMemoryQueue();
    const calls: string[] = [];
    const job: DailyNoteJob = { orgId: "org", personId: "fernando", date: "2026-11-06" };
    const sent: { name: string; opts: unknown }[] = [];
    const send = queue.send.bind(queue);
    queue.send = async (name, data, opts) => {
      sent.push({ name, opts });
      return send(name, data, opts);
    };
    const { tick } = await registerEndOfDay(queue, {
      scan: async () => [job],
      flow: {
        draft: async (o, p, d) => (calls.push(`draft:${o}:${p}:${d}`), { status: "created", note: { personId: p, date: d, released: [], reserved: [], state: "draft" }, usedModel: false, dmQueued: true }),
        expire: async (o, p, d) => (calls.push(`expire:${o}:${p}:${d}`), { state: "draft", changed: false }),
        confirmFromSlack: async (o) => (calls.push(`confirm:${o}`), null),
      },
    });

    expect(await tick()).toBe(1);
    expect(await tick()).toBe(1);
    await queue.send(QUEUES.slackInteraction, { orgId: "org", payload: { type: "block_actions" } });

    // A fila em memória entrega na hora; em produção o prazo espera 2 h (startAfterSeconds).
    expect(calls).toEqual(["draft:org:fernando:2026-11-06", "expire:org:fernando:2026-11-06", "confirm:org"]);
    expect(sent.find((s) => s.name === QUEUES.dailyNoteTimeout)?.opts).toEqual({ singletonKey: "org:fernando:2026-11-06", startAfterSeconds: 7200 });
  });

  it("rascunho pulado (sem evento nas últimas 24 h) não agenda prazo", async () => {
    const queue = new InMemoryQueue();
    const calls: string[] = [];
    const { tick } = await registerEndOfDay(queue, {
      scan: async () => [{ orgId: "org", personId: "yan", date: "2026-11-06" }],
      flow: {
        draft: async () => ({ status: "skipped", reason: "sem evento nas últimas 24 horas" }),
        expire: async () => (calls.push("expire"), { state: null, changed: false }),
        confirmFromSlack: async () => null,
      },
    });
    await tick();
    expect(calls).toEqual([]);
  });

  it("resumo do dia: entra na fila depois do rascunho e de novo quando a pessoa confirma pelo Slack", async () => {
    const queue = new InMemoryQueue();
    const summaries: string[] = [];
    const note = { personId: "fernando", date: "2026-11-06", released: [], reserved: [], state: "confirmed" as const, createdAt: new Date() };
    const { tick } = await registerEndOfDay(queue, {
      scan: async () => [{ orgId: "org", personId: "fernando", date: "2026-11-06" }],
      flow: {
        draft: async (_o, p, d) => ({ status: "created", note: { personId: p, date: d, released: [], reserved: [], state: "draft" }, usedModel: false, dmQueued: true }),
        expire: async () => ({ state: "draft", changed: false }),
        confirmFromSlack: async () => ({ status: "confirmed", note }),
      },
      summary: { generate: async (o, p, d) => (summaries.push(`${o}:${p}:${d}`), { status: "skipped", reason: "teste" }) },
    });
    await tick();
    await queue.send(QUEUES.slackInteraction, { orgId: "org", payload: { type: "block_actions" } });
    expect(summaries).toEqual(["org:fernando:2026-11-06", "org:fernando:2026-11-06"]);
  });
});

describe("Confirmar a nota do dia pelo Slack responde ao clique", () => {
  const note = { personId: "fernando", date: "2026-11-08", released: [], reserved: [], state: "confirmed" as const, createdAt: new Date() };
  const message = {
    text: "Nota do dia",
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "Nota do dia" } },
      { type: "actions", elements: [{ type: "button", action_id: "confirmar_nota" }, { type: "button", action_id: "editar_nota", url: "https://painel/nota-do-dia" }] },
    ],
  };
  const click = { type: "block_actions", response_url: "https://hooks.slack.com/actions/T/1/x", message, user: { id: "UFER" }, actions: [{ action_id: "confirmar_nota", value: "{}" }] };
  async function run(outcome: Awaited<ReturnType<EndOfDayWiring["flow"]["confirmFromSlack"]>>) {
    const queue = new InMemoryQueue();
    const replies: { url: string; body: any }[] = [];
    await registerEndOfDay(queue, {
      scan: async () => [],
      flow: { draft: async () => ({ status: "skipped", reason: "x" }), expire: async () => ({ state: null, changed: false }), confirmFromSlack: async () => outcome },
      respond: async (url, body) => void replies.push({ url, body }),
    });
    await queue.send(QUEUES.slackInteraction, { orgId: "org", payload: click });
    return replies;
  }

  it("confirmada: troca a mensagem, sem o botão Confirmar e com o estado", async () => {
    const [r] = await run({ status: "confirmed", note });
    expect(r!.url).toBe(click.response_url);
    expect(r!.body.replace_original).toBe(true);
    const actions = r!.body.blocks.find((b: any) => b.type === "actions");
    expect(actions.elements.map((e: any) => e.action_id)).toEqual(["editar_nota"]);
    expect(JSON.stringify(r!.body.blocks.at(-1))).toContain("Nota confirmada");
  });

  it("clique repetido numa nota já confirmada também tira o botão", async () => {
    const [r] = await run({ status: "already", reason: "nota já confirmada" });
    expect(r!.body.replace_original).toBe(true);
    expect(JSON.stringify(r!.body.blocks)).not.toContain("confirmar_nota");
    expect(JSON.stringify(r!.body.blocks.at(-1))).toContain("já estava confirmada");
  });

  it("outra pessoa ou nota que mudou: só quem clicou vê o motivo, a mensagem fica", async () => {
    expect((await run({ status: "denied", reason: "x" }))[0]!.body).toMatchObject({ replace_original: false, response_type: "ephemeral", text: "Só a própria pessoa confirma a nota do dia." });
    expect((await run({ status: "already", reason: "a nota mudou antes da confirmação" }))[0]!.body.response_type).toBe("ephemeral");
  });

  it("clique que não é da nota não responde", async () => {
    expect(await run(null)).toEqual([]);
  });
});
