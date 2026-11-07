import { InMemoryQueue, QUEUES } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerEndOfDay, type DailyNoteJob } from "./end-of-day.ts";
import { createInteractionRouter } from "./slack-interactions.ts";

const log = { info: () => undefined, error: () => undefined } as never;

describe("registerEndOfDay", () => {
  it("agenda → rascunho → prazo de 2 h; repetir a agenda não duplica; o clique chega à nota e aos outros tratadores", async () => {
    const queue = new InMemoryQueue();
    const calls: string[] = [];
    const job: DailyNoteJob = { orgId: "org", personId: "fernando", date: "2026-11-06" };
    const sent: { name: string; opts: unknown }[] = [];
    const send = queue.send.bind(queue);
    queue.send = async (name, data, opts) => {
      sent.push({ name, opts });
      return send(name, data, opts);
    };
    const interactions = createInteractionRouter(log);
    const { tick } = await registerEndOfDay(queue, {
      interactions,
      scan: async () => [job],
      flow: {
        draft: async (o, p, d) => (calls.push(`draft:${o}:${p}:${d}`), { status: "created", note: { personId: p, date: d, released: [], reserved: [], state: "draft" }, usedModel: false, dmQueued: true }),
        expire: async (o, p, d) => (calls.push(`expire:${o}:${p}:${d}`), { state: "draft", changed: false }),
        confirmFromSlack: async (o) => (calls.push(`confirm:${o}`), null),
      },
    });

    // Um só consumidor da fila: o "Resolveu" do #19 entra no mesmo roteador e também recebe o clique.
    interactions.add("resolveu", async (j) => (calls.push(`resolveu:${j.orgId}`), "ignored"));
    await interactions.listen(queue);
    expect(await tick()).toBe(1);
    expect(await tick()).toBe(1);
    await queue.send(QUEUES.slackInteraction, { orgId: "org", payload: { type: "block_actions" } });

    // A fila em memória entrega na hora; em produção o prazo espera 2 h (startAfterSeconds).
    expect(calls).toEqual(["draft:org:fernando:2026-11-06", "expire:org:fernando:2026-11-06", "confirm:org", "resolveu:org"]);
    expect(sent.find((s) => s.name === QUEUES.dailyNoteTimeout)?.opts).toEqual({ singletonKey: "org:fernando:2026-11-06", startAfterSeconds: 7200 });
  });

  it("rascunho pulado (sem evento nas últimas 24 h) não agenda prazo", async () => {
    const queue = new InMemoryQueue();
    const calls: string[] = [];
    const { tick } = await registerEndOfDay(queue, {
      interactions: createInteractionRouter(log),
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
});
