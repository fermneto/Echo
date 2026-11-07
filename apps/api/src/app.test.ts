import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";

describe("api", () => {
  it("/health responde 200", async () => {
    const res = await createApp({ ready: async () => true }).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "api" });
  });

  it("/ready responde 200 com banco ok e 503 sem banco", async () => {
    expect((await createApp({ ready: async () => true }).request("/ready")).status).toBe(200);
    const down = await createApp({ ready: async () => false }).request("/ready");
    expect(down.status).toBe(503);
    expect(await down.json()).toEqual({ ok: false, checks: { db: false } });
  });

  it("/ready trata erro de verificação como indisponível", async () => {
    const res = await createApp({ ready: () => Promise.reject(new Error("x")) }).request("/ready");
    expect(res.status).toBe(503);
  });
});
