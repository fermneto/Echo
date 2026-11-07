import { InMemoryQueue, QUEUES, type SendOptions } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerNight } from "./night.ts";

function setup(at: string) {
  const queue = new InMemoryQueue();
  const calls: string[] = [];
  const sent: { name: string; opts?: SendOptions }[] = [];
  const send = queue.send.bind(queue);
  queue.send = async (name, data, opts) => (sent.push({ name, ...(opts ? { opts } : {}) }), send(name, data, opts));
  const wiring = registerNight(queue, {
    night: {
      prepareAndSubmit: async (o) => (calls.push(`lote:${o}`), { queued: 1, tooLarge: 0, skipped: 0 }),
      collect: async (o) => (calls.push(`buscar:${o}`), { reviewed: 0, noFindings: 0, failed: 0, pending: 0 }),
    },
    morning: { build: async (o, p, d) => (calls.push(`plano:${o}:${p}:${d}`), { status: "skipped", reason: "x" }) },
    orgIds: async () => ["org"],
    dueMorning: async () => [{ orgId: "org", personId: "fernando", date: "2026-11-09" }],
    nightHourUtc: 5,
    now: () => new Date(at),
  });
  return { wiring, calls, sent };
}

describe("registerNight", () => {
  it("na hora da noite: lote por empresa, com 3 tentativas e 30 min entre elas; sempre busca os lotes", async () => {
    const { wiring, calls, sent } = setup("2026-11-09T05:02:00Z");
    expect(await (await wiring).tick()).toEqual({ night: 1, morning: 1 });
    expect(calls).toEqual(["lote:org", "buscar:org", "plano:org:fernando:2026-11-09"]);
    expect(sent.find((s) => s.name === QUEUES.nightReview)?.opts).toEqual({ singletonKey: "org:2026-11-09", retryLimit: 2, retryDelaySeconds: 1800 });
  });

  it("fora da hora da noite, só busca os lotes e monta os planos", async () => {
    const { wiring, calls } = setup("2026-11-09T11:45:00Z");
    expect(await (await wiring).tick()).toEqual({ night: 0, morning: 1 });
    expect(calls).toEqual(["buscar:org", "plano:org:fernando:2026-11-09"]);
  });
});
