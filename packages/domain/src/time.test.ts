import { describe, expect, it } from "vitest";
import { addDays, coveredMs, endOfLocalDay, HOUR, localDate, weekdayOf, zonedParts, zonedTime } from "./time.ts";

describe("datas no fuso da pessoa", () => {
  // 06:12 UTC de sexta: 03:12 em Fortaleza, 08:12 em Joanesburgo, 15:12 em Tóquio (cena 1).
  const scene = new Date("2026-11-06T06:12:00Z");

  it("lê hora e dia em Fortaleza, Joanesburgo e Tóquio", () => {
    expect(zonedParts(scene, "America/Fortaleza")).toMatchObject({ hour: 3, minute: 12, weekday: 5 });
    expect(zonedParts(scene, "Africa/Johannesburg")).toMatchObject({ hour: 8, minute: 12, weekday: 5 });
    expect(zonedParts(scene, "Asia/Tokyo")).toMatchObject({ hour: 15, minute: 12, weekday: 5 });
  });

  it("vira o dia em Tóquio antes de UTC", () => {
    const late = new Date("2026-11-06T16:30:00Z");
    expect(localDate(late, "Asia/Tokyo")).toBe("2026-11-07");
    expect(localDate(late, "America/Fortaleza")).toBe("2026-11-06");
  });

  it("converte hora local em instante nos três fusos", () => {
    expect(zonedTime("2026-11-06", "09:00", "America/Fortaleza").toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(zonedTime("2026-11-06", "08:00", "Africa/Johannesburg").toISOString()).toBe("2026-11-06T06:00:00.000Z");
    expect(zonedTime("2026-11-06", "09:00", "Asia/Tokyo").toISOString()).toBe("2026-11-06T00:00:00.000Z");
  });

  it("respeita o horário de verão (Berlim)", () => {
    // Antes e depois da troca de março: +1 h e +2 h.
    expect(zonedTime("2026-03-28", "09:00", "Europe/Berlin").toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(zonedTime("2026-03-30", "09:00", "Europe/Berlin").toISOString()).toBe("2026-03-30T07:00:00.000Z");
    // 02:30 não existe em 29/03: o relógio pula para 03:30.
    const gap = zonedTime("2026-03-29", "02:30", "Europe/Berlin");
    expect(zonedParts(gap, "Europe/Berlin")).toMatchObject({ hour: 3, minute: 30 });
    // 02:30 acontece duas vezes em 25/10: fica a primeira.
    expect(zonedTime("2026-10-25", "02:30", "Europe/Berlin").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("calcula o fim do dia local, que é onde o prazo termina", () => {
    expect(endOfLocalDay("2026-11-06", "America/Fortaleza").toISOString()).toBe("2026-11-07T03:00:00.000Z");
    expect(endOfLocalDay("2026-11-06", "Asia/Tokyo").toISOString()).toBe("2026-11-06T15:00:00.000Z");
  });

  it("soma dias e acha o dia da semana sem depender do fuso", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-11-07")).toBe(6);
  });

  it("mede o tempo coberto sem contar sobreposição duas vezes", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 10, 6, h));
    const intervals = [{ start: t(1), end: t(4) }, { start: t(3), end: t(6) }, { start: t(10), end: t(30) }];
    expect(coveredMs(intervals, t(0), t(12)) / HOUR).toBe(7);
  });
});
