import type { GainsResult, GainsTotals } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { baselineNote, gainsOrgId, gainsRows } from "./gains";

const totals: GainsTotals = {
  status: "ok",
  scope: { kind: "org" },
  people: 7,
  period: { from: new Date("2026-10-08T12:00:00Z"), to: new Date("2026-11-07T12:00:00Z") },
  waitAvoided: { hours: 8.5, answers: 2 },
  resolved: { yes: 1, no: 1, unrated: 1 },
  firstReview: { hours: 7, before: 26, prs: 2 },
  reviewRounds: { perPr: 1.5, before: null, prs: 2 },
  firstAnalysis: { hours: 2, prs: 2 },
  fixes: { prepared: 1, approved: 1 },
  coverage: { tasks: 2, approvalHours: 3, plans: 1 },
  cost: { usd: 3, perAvoidedHourUsd: 0.35 },
  baseline: { capturedAt: "2026-10-18T12:00:00.000Z", from: "2026-07-20T12:00:00.000Z", to: "2026-10-18T12:00:00.000Z", prs: 14 },
};

describe("tela Ganhos", () => {
  it("só totais, com o tipo de cada medida e o antes quando existe", () => {
    expect(gainsRows(totals)).toEqual([
      { label: "Espera evitada", kind: "estimativa", value: "8,5 h em 2 respostas" },
      { label: "Resolveram a dúvida", kind: "medido", value: "1 de 2 avaliadas · 1 sem avaliação" },
      { label: "Primeira revisão humana", kind: "medido", value: "7 h de mediana (antes: 26 h)" },
      { label: "Idas e voltas por PR", kind: "medido", value: "1,5 de mediana" },
      { label: "Primeira análise", kind: "medido", value: "2 h de mediana em 2 PRs" },
      { label: "Correções aproveitadas", kind: "medido", value: "1 de 1 preparada" },
      { label: "Cobertura em ausências", kind: "medido", value: "2 tarefas redistribuídas · 3 h até a aprovação" },
      { label: "Custo", kind: "medido", value: "US$ 3,00 · US$ 0,35 por hora de espera evitada" },
    ]);
    expect(baselineNote(totals)).toBe("Antes: 20/07/2026 a 18/10/2026, 14 PRs, medido uma vez.");
  });

  it("equipe pequena não tem linhas; equipe sem custo não mostra custo", () => {
    const small: GainsResult = { status: "too_small", scope: { kind: "team", teamId: "t" }, people: 2, min: 3 };
    expect(gainsRows(small)).toEqual([]);
    expect(gainsRows({ ...totals, cost: null }).map((r) => r.label)).not.toContain("Custo");
    expect(gainsRows({ ...totals, cost: { usd: 0.04, perAvoidedHourUsd: 0.0044 } }).at(-1)!.value).toBe("US$ 0,04 · menos de US$ 0,01 por hora de espera evitada");
    expect(baselineNote({ ...totals, baseline: null })).toMatch(/ainda não medida/);
  });

  it("personas da demonstração leem a empresa do seed", () => {
    expect(gainsOrgId("demo")).toBe("00000000-0000-4000-8000-000000000001");
    expect(gainsOrgId("abc")).toBe("abc");
  });
});
