import { describe, expect, it } from "vitest";
import { DEMO_NOW, findPersona } from "./demo/personas";
import { railFor, railStateAt } from "./schedule";

const fernando = findPersona("fernando")!;
const eduardo = findPersona("eduardo")!;
const yan = findPersona("yan")!;

describe("railStateAt", () => {
  it("no instante da cena 1: Fernando com o agente, Eduardo no expediente, Yan de férias", () => {
    expect(railStateAt(fernando, DEMO_NOW)).toBe("twin");
    expect(railStateAt(eduardo, DEMO_NOW)).toBe("on");
    expect(railStateAt(yan, DEMO_NOW)).toBe("wait");
  });

  it("Fernando entra no expediente às 9h de Fortaleza (12h UTC) e sai às 18h", () => {
    expect(railStateAt(fernando, new Date("2026-11-06T11:59:00Z"))).toBe("twin");
    expect(railStateAt(fernando, new Date("2026-11-06T12:00:00Z"))).toBe("on");
    expect(railStateAt(fernando, new Date("2026-11-06T21:00:00Z"))).toBe("twin");
  });

  it("fim de semana fica com o agente", () => {
    expect(railStateAt(eduardo, new Date("2026-11-07T10:00:00Z"))).toBe("twin");
  });
});

describe("railFor", () => {
  it("24h em 48 segmentos, metade no passado e o agora no meio", () => {
    const rail = railFor(fernando, DEMO_NOW);
    expect(rail.segments).toHaveLength(48);
    expect(rail.nowIndex).toBe(24);
    expect(rail.segments.filter((s) => s.past)).toHaveLength(24);
    expect(rail.segments[rail.nowIndex]!.state).toBe("twin");
  });
});
