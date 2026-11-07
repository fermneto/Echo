import { describe, expect, it, vi } from "vitest";
import { availabilityAt, nextStart } from "./availability";
import { findPersona } from "./personas";

const fortaleza = { timezone: "America/Fortaleza", city: "Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } };

describe("disponibilidade pelo relógio", () => {
  it("no expediente, a pessoa responde; fora dele, volta no próximo início", () => {
    // Sexta 06/11, 10:00 em Fortaleza (13:00 UTC).
    expect(availabilityAt(fortaleza, null, new Date("2026-11-06T13:00:00Z"))).toEqual({ kind: "working" });
    // Sexta 06/11, 03:12 em Fortaleza.
    expect(availabilityAt(fortaleza, null, new Date("2026-11-06T06:12:00Z"))).toEqual({ kind: "off", returns: "hoje às 9h, horário de Fortaleza" });
  });

  it("depois do expediente de sexta, volta na segunda; no sábado à noite, também", () => {
    expect(nextStart(fortaleza, new Date("2026-11-06T22:00:00Z"))).toBe("segunda às 9h, horário de Fortaleza");
    expect(nextStart(fortaleza, new Date("2026-11-08T01:00:00Z"))).toBe("segunda às 9h, horário de Fortaleza");
    // Domingo 23:00 em Fortaleza: amanhã.
    expect(nextStart(fortaleza, new Date("2026-11-09T02:00:00Z"))).toBe("amanhã às 9h, horário de Fortaleza");
  });

  it("férias não dependem da hora", () => {
    const v = { kind: "vacation" as const, until: "segunda" };
    expect(availabilityAt(fortaleza, v, new Date("2026-11-06T13:00:00Z"))).toBe(v);
  });

  it("a persona lê a disponibilidade na hora em que é consultada", () => {
    const fernando = findPersona("fernando")!;
    vi.setSystemTime(new Date("2026-11-06T13:00:00Z"));
    expect(fernando.availability.kind).toBe("working");
    vi.setSystemTime(new Date("2026-11-06T22:00:00Z"));
    // Sexta, 19h em Fortaleza: volta no sábado (todos trabalham no fim de semana).
    expect(fernando.availability).toEqual({ kind: "off", returns: "amanhã às 9h, horário de Fortaleza" });
    // Segunda, 19h: a terça é folga, então volta na quarta.
    vi.setSystemTime(new Date("2026-11-09T22:00:00Z"));
    expect(fernando.availability).toEqual({ kind: "off", returns: "quarta às 9h, horário de Fortaleza" });
    expect(findPersona("yan")!.availability.kind).toBe("vacation");
  });
});
