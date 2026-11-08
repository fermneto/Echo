import { InMemoryQueue, QUEUES, type SendOptions } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerFix } from "./fix.ts";

describe("registerFix", () => {
  it("um job por revisão, sem nova tentativa e com prazo maior que a sessão; sincroniza os rascunhos", async () => {
    const queue = new InMemoryQueue();
    const sent: { name: string; opts?: SendOptions }[] = [];
    const send = queue.send.bind(queue);
    queue.send = async (name, data, opts) => (sent.push({ name, ...(opts ? { opts } : {}) }), send(name, data, opts));
    const calls: string[] = [];
    const wiring = await registerFix(queue, {
      fix: {
        pending: async (o) => (o === "org" ? ["rv1", "rv2"] : []),
        run: async (o, r) => (calls.push(`run:${o}:${r}`), { status: "skipped", reason: "x" }),
        sync: async (o) => (calls.push(`sync:${o}`), { ready: o === "org" ? 1 : 0, applied: 0, failed: 0 }),
      },
      orgIds: async () => ["org", "outra"],
      timeoutMs: 1_200_000,
    });
    expect(await wiring.tick()).toEqual({ queued: 2, ready: 1, applied: 0 });
    expect(calls).toEqual(["run:org:rv1", "run:org:rv2", "sync:org", "sync:outra"]);
    expect(sent[0]).toEqual({ name: QUEUES.fixRun, opts: { singletonKey: "rv1", retryLimit: 0, expireInSeconds: 1800 } });
    // A mesma revisão não entra duas vezes.
    expect((await wiring.tick()).queued).toBe(0);
  });
});
