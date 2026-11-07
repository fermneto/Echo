import { describe, expect, it } from "vitest";
import { FixedClock } from "./clock.ts";

describe("FixedClock", () => {
  it("fica parado e avança à mão", () => {
    const c = new FixedClock("2026-11-07T06:12:00Z");
    expect(c.now().toISOString()).toBe("2026-11-07T06:12:00.000Z");
    c.advance(60_000);
    expect(c.now().toISOString()).toBe("2026-11-07T06:13:00.000Z");
  });
});
