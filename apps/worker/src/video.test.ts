import { InMemoryQueue, QUEUES, type SendOptions } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerVideo, type VideoAgenda } from "./video.ts";

const NOW = new Date("2026-11-07T12:00:00Z");

function wiring(enabled: boolean) {
  const calls: string[] = [];
  const agenda: VideoAgenda = {
    queueTeamVideos: async (o) => (calls.push(`fila:${o}`), o === "org" ? 1 : 0),
    queuedTeamVideos: async (o) => (o === "org" ? ["v1", "v2"] : []),
    failStuckTeamVideos: async (o) => (calls.push(`parados:${o}`), 0),
    expireTeamVideos: async (o) => (o === "org" ? ["file_velho"] : []),
  };
  const video = {
    enabled: () => enabled,
    process: async (o: string, id: string) => (calls.push(`grava:${o}:${id}`), { status: "skipped" as const, reason: "x" }),
    deleteFile: async (id: string) => void calls.push(`apaga:${id}`),
  };
  return { calls, agenda, video };
}

describe("registerVideo", () => {
  it("equipe pronta vira fila; cada vídeo é um job sem nova tentativa; vencido sai do armazenamento", async () => {
    const queue = new InMemoryQueue();
    const sent: { name: string; opts?: SendOptions }[] = [];
    const send = queue.send.bind(queue);
    queue.send = async (name, data, opts) => (sent.push({ name, ...(opts ? { opts } : {}) }), send(name, data, opts));
    const w = wiring(true);
    const v = await registerVideo(queue, { video: w.video, agenda: w.agenda, orgIds: async () => ["org", "outra"], timeoutMs: 1_200_000, now: () => NOW });
    expect(await v.tick()).toEqual({ teams: 1, queued: 2, removed: 1 });
    expect(w.calls).toContain("apaga:file_velho");
    expect(w.calls).toContain("grava:org:v1");
    expect(sent[0]).toEqual({ name: QUEUES.videoRun, opts: { singletonKey: "v1", retryLimit: 0, expireInSeconds: 1800 } });
    expect((await v.tick()).queued).toBe(0);
  });

  it("desligado: só tira do armazenamento o que venceu", async () => {
    const w = wiring(false);
    const v = await registerVideo(new InMemoryQueue(), { video: w.video, agenda: w.agenda, orgIds: async () => ["org"], timeoutMs: 1_200_000, now: () => NOW });
    expect(await v.tick()).toEqual({ teams: 0, queued: 0, removed: 1 });
    expect(w.calls).toEqual(["apaga:file_velho"]);
  });
});
