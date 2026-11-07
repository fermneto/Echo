import { describe, expect, it } from "vitest";
import { awayRows, demoAwayRows, lastWorkEnd } from "./away-log";
import { NIGHT_LOG } from "./demo/feed";

const fortaleza = { timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } };

describe("fim do último expediente", () => {
  it("de madrugada, é o fim do dia anterior; no expediente, também; depois do expediente, o de hoje", () => {
    // Sexta 06/11, 03:12 em Fortaleza: quinta às 18h (21:00 UTC).
    expect(lastWorkEnd(fortaleza, new Date("2026-11-06T06:12:00Z"))).toEqual(new Date("2026-11-05T21:00:00Z"));
    // Sexta 10:00: ainda quinta às 18h.
    expect(lastWorkEnd(fortaleza, new Date("2026-11-06T13:00:00Z"))).toEqual(new Date("2026-11-05T21:00:00Z"));
    // Sexta 19:00: hoje às 18h.
    expect(lastWorkEnd(fortaleza, new Date("2026-11-06T22:00:00Z"))).toEqual(new Date("2026-11-06T21:00:00Z"));
  });

  it("na segunda de manhã, volta ao fim de sexta", () => {
    expect(lastWorkEnd(fortaleza, new Date("2026-11-09T11:00:00Z"))).toEqual(new Date("2026-11-06T21:00:00Z"));
  });

  it("sem dia de trabalho, as últimas 24 horas", () => {
    const now = new Date("2026-11-06T13:00:00Z");
    expect(lastWorkEnd({ ...fortaleza, workHours: { ...fortaleza.workHours, days: [] } }, now)).toEqual(new Date("2026-11-05T13:00:00Z"));
  });
});

describe("registro da demonstração", () => {
  it("só da pessoa, do mais recente ao mais antigo, na hora local dela", () => {
    const rows = demoAwayRows("fernando", "America/Fortaleza", NIGHT_LOG);
    expect(rows.map((r) => r.time)).toEqual(["03:15", "03:12", "02:40"]);
    expect(rows[0]).toMatchObject({ ref: "ech-128", tone: "wait" });
    expect(rows[1]).toMatchObject({ tone: "ok" });
    expect(rows[0]!.text).toMatch(/^Não liberou/);
  });

  it("quem não tem nada recebe lista vazia", () => {
    expect(demoAwayRows("rita", "Africa/Johannesburg", NIGHT_LOG)).toEqual([]);
  });
});

describe("registro do banco", () => {
  it("junta perguntas, correções e plano, sem a assinatura do agente e sem texto expirado", () => {
    const rows = awayRows(
      {
        questions: [
          { id: "q1", askerName: "Eduardo", text: null, answer: "Agente de Fernando: a ech-131 está liberada.", needsOwner: false, sources: [{ label: "nota do dia de Fernando (confirmada)", ref: "daily_note:x" }], at: new Date("2026-11-06T06:12:00Z") },
          { id: "q2", askerName: null, text: "posso mexer na ech-128?", answer: null, needsOwner: true, sources: [], at: new Date("2026-11-06T06:15:00Z") },
        ],
        fixes: [{ id: "f1", prNumber: 41, prTitle: "Tempo limite", state: "ready", at: new Date("2026-11-06T05:40:00Z") }],
        plan: { date: "2026-11-06", items: 2, at: new Date("2026-11-06T09:00:00Z") },
      },
      "America/Fortaleza",
    );
    expect(rows.map((r) => r.time)).toEqual(["06:00", "03:15", "03:12", "02:40"]);
    expect(rows[0]!.text).toBe("Montou seu plano da manhã com 2 itens.");
    expect(rows[1]).toMatchObject({ text: "Alguém perguntou: “posso mexer na ech-128?”. Ficou para você decidir.", tone: "wait" });
    expect(rows[2]).toMatchObject({ text: "Respondeu a Eduardo: a ech-131 está liberada.", ref: "nota do dia de Fernando (confirmada)", tone: "ok" });
    expect(rows[3]).toMatchObject({ ref: "PR 41", tone: "wait" });
  });

  it("plano vazio não vira linha", () => {
    expect(awayRows({ questions: [], fixes: [], plan: { date: "2026-11-06", items: 0, at: new Date() } }, "UTC")).toEqual([]);
  });
});
