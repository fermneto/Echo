import { InMemoryQueue, QUEUES, type PingMessage } from "@echo/jobs";
import { describe, expect, it } from "vitest";
import { registerPing } from "./ping.ts";

describe("reviewer ping", () => {
  it("responde pong com o mesmo nonce", async () => {
    const q = new InMemoryQueue();
    const pongs: PingMessage[] = [];
    await q.work<PingMessage>(QUEUES.reviewerPong, async (j) => void pongs.push(j.data));
    await registerPing(q);
    await q.send<PingMessage>(QUEUES.reviewerPing, { from: "worker", sentAt: new Date().toISOString(), nonce: "n1" });
    expect(pongs).toEqual([expect.objectContaining({ from: "reviewer", nonce: "n1" })]);
  });
});
