import { describe, expect, it } from "vitest";
import { GET } from "./route.ts";

describe("web /api/health", () => {
  it("responde ok", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "web" });
  });
});
