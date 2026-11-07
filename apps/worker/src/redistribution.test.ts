import { InMemoryQueue, QUEUES } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerRedistribution } from "./redistribution.ts";

describe("registerRedistribution", () => {
  it("ausência registrada monta o plano; a passada conclui planos e procura complemento e volta", async () => {
    const queue = new InMemoryQueue();
    const calls: string[] = [];
    const wiring = await registerRedistribution(queue, {
      flow: {
        propose: async (o, a) => (calls.push(`plano:${o}:${a}`), { status: "skipped", reason: "x" }),
        sync: async (o) => (calls.push(`concluir:${o}`), { done: 0 }),
        scan: async (o) => (calls.push(`agenda:${o}`), { complements: 0, returns: 0 }),
      },
      orgIds: async () => ["org"],
    });
    await queue.send(QUEUES.absenceRegistered, { orgId: "org", absenceId: "a1" }, { singletonKey: "a1" });
    expect(await wiring.tick()).toBe(1);
    expect(calls).toEqual(["plano:org:a1", "concluir:org", "agenda:org"]);
    expect(QUEUES.absenceRegistered).toBe("absence.registered");
  });
});
