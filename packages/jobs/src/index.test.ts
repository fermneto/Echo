import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryQueue, PgBossQueue, QUEUES, type PingMessage } from "./index.ts";

describe("InMemoryQueue", () => {
  it("entrega jobs enviados antes e depois do handler", async () => {
    const q = new InMemoryQueue();
    const got: string[] = [];
    await q.send("a", { n: 1 });
    await q.work<{ n: number }>("a", async (j) => void got.push(`a${j.data.n}`));
    await q.send("a", { n: 2 });
    expect(got).toEqual(["a1", "a2"]);
  });

  it("respeita singletonKey", async () => {
    const q = new InMemoryQueue();
    expect(await q.send("a", {}, { singletonKey: "x" })).not.toBeNull();
    expect(await q.send("a", {}, { singletonKey: "x" })).toBeNull();
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("PgBossQueue (Postgres real)", () => {
  const queue = new PgBossQueue(url!, { pollingIntervalSeconds: 0.5 });

  beforeAll(async () => {
    await queue.start();
  }, 30_000);
  afterAll(async () => {
    await queue.stop();
  });

  it("entrega um ping ao reviewer", async () => {
    const nonce = randomUUID();
    const received = new Promise<PingMessage>((resolve) => {
      void queue.work<PingMessage>(QUEUES.reviewerPing, async (job) => {
        if (job.data.nonce === nonce) resolve(job.data);
      });
    });
    await queue.send<PingMessage>(QUEUES.reviewerPing, { from: "teste", sentAt: new Date().toISOString(), nonce });
    await expect(received).resolves.toMatchObject({ from: "teste", nonce });
  }, 20_000);
});
