import { describe, expect, it } from "vitest";
import { dueLabel } from "./due";

describe("dueLabel", () => {
  const tz = "America/Fortaleza";
  it("conta os dias no fuso de quem lê", () => {
    expect(dueLabel("2026-11-06", new Date("2026-11-06T15:00:00Z"), tz)).toBe("vence hoje (sexta-feira, 06/11)");
    expect(dueLabel("2026-11-06", new Date("2026-11-05T15:00:00Z"), tz)).toBe("vence amanhã (sexta-feira, 06/11)");
    expect(dueLabel("2026-11-06", new Date("2026-11-07T15:00:00Z"), tz)).toBe("venceu ontem (sexta-feira, 06/11)");
    expect(dueLabel("2026-11-06", new Date("2026-11-09T15:00:00Z"), tz)).toBe("venceu há 3 dias (sexta-feira, 06/11)");
  });
});
