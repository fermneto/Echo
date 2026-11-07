import { InMemoryQueue, QUEUES, type SendOptions } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerGains } from "./gains.ts";

describe("registerGains", () => {
  it("envia o resumo com chave pessoa + data + momento, limpa as linhas e mede a referência só com GitHub ligado", async () => {
    const queue = new InMemoryQueue();
    const sent: { name: string; opts?: SendOptions }[] = [];
    const send = queue.send.bind(queue);
    queue.send = async (name, data, opts) => (sent.push({ name, ...(opts ? { opts } : {}) }), send(name, data, opts));
    const calls: string[] = [];
    const history = { pullRequests: async () => [] };
    const wiring = await registerGains(queue, {
      digest: {
        send: async (o, p, d) => (calls.push(`resumo:${o}:${p}:${d.date}:${d.slot}`), { status: "sent", items: 1, sections: {} }),
        purge: async (o) => (calls.push(`limpeza:${o}`), 2),
      },
      gains: { captureBaseline: async (o, h) => (calls.push(`referencia:${o}:${h ? "github" : "sem"}`), { status: "skipped", reason: "x" }) },
      dueDigests: async () => [{ orgId: "a", personId: "fernando", date: "2026-11-09", slot: "inicio" }],
      orgIds: async () => ["a", "b", "c"],
      needsBaseline: async (o) => o !== "c",
      history: async (o) => (o === "a" ? history : null),
      now: () => new Date("2026-11-09T12:05:00Z"),
    });
    expect(await wiring.tick()).toEqual({ digests: 1, purged: 6, baselines: 1 });
    expect(calls).toEqual(["resumo:a:fernando:2026-11-09:inicio", "limpeza:a", "referencia:a:github", "limpeza:b", "limpeza:c"]);
    expect(sent.find((s) => s.name === QUEUES.awayDigestSend)?.opts).toEqual({ singletonKey: "a:fernando:2026-11-09:inicio", retryLimit: 2 });
    expect(sent.filter((s) => s.name === QUEUES.gainsBaseline)).toHaveLength(1);
  });
});
