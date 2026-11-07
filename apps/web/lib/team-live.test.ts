import type { Absence, Person } from "@echo/domain";
import { describe, expect, it, vi } from "vitest";
import { DEMO_PERSON_IDS } from "./agent";
import { TEAM } from "./demo/team";
import { availabilityFrom, countsOf, loadTeam, whenLabel, withLiveAvailability } from "./team-live";

const WEEK = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const row = (id: string, timezone: string, workHours = WEEK): Person => ({ id: DEMO_PERSON_IDS[id]!, orgId: "org", name: id, role: "member", timezone, workHours, skills: [], areas: [], active: true });
const fernando = row("fernando", "America/Fortaleza");
// Sexta 06/11, 03:12 em Fortaleza.
const NOW = new Date("2026-11-06T06:12:00Z");

describe("quando volta, em palavras", () => {
  it("hoje, amanhã, dia da semana ou data", () => {
    expect(whenLabel(new Date("2026-11-06T12:00:00Z"), NOW, "America/Fortaleza")).toBe("hoje às 9h");
    expect(whenLabel(new Date("2026-11-07T17:30:00Z"), NOW, "America/Fortaleza")).toBe("amanhã às 14h30");
    expect(whenLabel(new Date("2026-11-09T12:00:00Z"), NOW, "America/Fortaleza")).toBe("segunda às 9h");
    expect(whenLabel(new Date("2026-11-16T12:00:00Z"), NOW, "America/Fortaleza")).toBe("16/11 às 9h");
  });
});

describe("disponibilidade pelo isAway", () => {
  it("fora do expediente, o gêmeo cobre até a próxima entrada", () => {
    expect(availabilityFrom(fernando, [], NOW, "Fortaleza")).toEqual({ kind: "off", returns: "hoje às 9h, horário de Fortaleza" });
    expect(availabilityFrom(fernando, [], new Date("2026-11-06T13:00:00Z"), "Fortaleza")).toEqual({ kind: "working" });
  });

  it("férias registradas viram 'de férias até' o último dia; ausência curta, a volta exata", () => {
    const vacation: Absence = { personId: fernando.id, kind: "vacation", startsAt: new Date("2026-11-05T00:00:00Z"), endsAt: new Date("2026-11-14T03:00:00Z") };
    expect(availabilityFrom(fernando, [vacation], new Date("2026-11-06T13:00:00Z"), "Fortaleza")).toEqual({ kind: "vacation", until: "13/11" });
    const ooo: Absence = { personId: fernando.id, kind: "ooo", startsAt: new Date("2026-11-06T12:00:00Z"), endsAt: new Date("2026-11-06T17:30:00Z") };
    expect(availabilityFrom(fernando, [ooo], new Date("2026-11-06T13:00:00Z"), "Fortaleza")).toEqual({ kind: "off", returns: "hoje às 14h30, horário de Fortaleza" });
  });
});

describe("equipe com o banco", () => {
  it("só as personas com linha no banco mudam; fuso diferente leva a cidade junto", () => {
    const yanVacation: Absence = { personId: DEMO_PERSON_IDS.yan!, kind: "vacation", startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: new Date("2026-11-08T15:00:00Z") };
    const team = withLiveAvailability(TEAM, [fernando, row("yan", "Asia/Tokyo"), row("marina", "America/Sao_Paulo")], [yanVacation], NOW);
    const by = (id: string) => team.find((p) => p.id === id)!;
    expect(team).toHaveLength(TEAM.length);
    expect(by("fernando").availability).toEqual({ kind: "off", returns: "hoje às 9h, horário de Fortaleza" });
    expect(by("yan").availability).toEqual({ kind: "vacation", until: "08/11" });
    expect(by("marina")).toMatchObject({ city: "São Paulo", cityCode: "SAO", timezone: "America/Sao_Paulo", availability: { kind: "off" } });
    // Sem linha no banco: igual à demonstração.
    expect(by("eduardo")).toBe(TEAM.find((p) => p.id === "eduardo"));
    expect(countsOf(team).total).toBe(TEAM.length);
  });

  it("sem banco, a equipe da demonstração; com falha na leitura, também", async () => {
    expect(await loadTeam(NOW, { hasDb: false })).toBe(TEAM);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadTeam(NOW, { hasDb: true, read: () => Promise.reject(new Error("fora do ar")) })).toBe(TEAM);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("com banco, lê a empresa da demonstração", async () => {
    const read = vi.fn(async () => ({ people: [fernando], absences: [] }));
    const team = await loadTeam(NOW, { hasDb: true, read });
    expect(read).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
    expect(team.find((p) => p.id === "yan")!.availability.kind).toBe("vacation");
  });
});
