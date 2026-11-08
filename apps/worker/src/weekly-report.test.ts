import { DEDUPE_SECONDS, InMemoryQueue, QUEUES, type SendOptions } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerWeeklyReport } from "./weekly-report.ts";

describe("registerWeeklyReport", () => {
  it("cria o relatório devido com chave pessoa + semana e passa pela agenda de envio de cada empresa", async () => {
    const queue = new InMemoryQueue();
    const sent: { name: string; opts?: SendOptions }[] = [];
    const send = queue.send.bind(queue);
    queue.send = async (name, data, opts) => (sent.push({ name, ...(opts ? { opts } : {}) }), send(name, data, opts));
    const calls: string[] = [];
    const wiring = await registerWeeklyReport(queue, {
      flow: {
        build: async (o, p, w, c) => (calls.push(`relatorio:${o}:${p}:${w}:${c.toISOString()}`), { status: "skipped", reason: "x" }),
        sync: async (o) => (calls.push(`agenda:${o}`), { noticed: 0, sent: 0, withoutNotice: 0 }),
      },
      orgIds: async () => ["org"],
      due: async () => [{ orgId: "org", personId: "carla", week: "2026-W45", cutoff: "2026-11-06T21:00:00.000Z" }],
      now: () => new Date("2026-11-06T21:05:00Z"),
    });
    expect(await wiring.tick()).toEqual({ built: 1, synced: 1 });
    expect(calls).toEqual(["relatorio:org:carla:2026-W45:2026-11-06T21:00:00.000Z", "agenda:org"]);
    expect(sent.find((s) => s.name === QUEUES.weeklyReportBuild)?.opts).toEqual({ singletonKey: "org:carla:2026-W45", singletonSeconds: DEDUPE_SECONDS.perDay, retryLimit: 2 });
  });
});
