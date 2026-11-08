import { describe, expect, it } from "vitest";
import { budgetStatus, BUDGET, DAY_RUNS, runCost, totalCost, totalsByFlow } from "./runs";

describe("custo das execuções", () => {
  it("custo sai dos tokens e da tabela de preços; lote paga metade", () => {
    const base = { model: "claude-sonnet-5-5" as const, inputTokens: 1_000_000, outputTokens: 100_000 };
    expect(runCost(base)).toBeCloseTo(3);
    expect(runCost({ ...base, batch: true })).toBeCloseTo(1.5);
    expect(runCost({ model: null, inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it("os totais por fluxo somam o custo do dia e contam o que saiu por regra", () => {
    const totals = totalsByFlow(DAY_RUNS);
    expect(totals.reduce((s, t) => s + t.costUsd, 0)).toBeCloseTo(totalCost(DAY_RUNS));
    expect(totals.reduce((s, t) => s + t.runs, 0)).toBe(DAY_RUNS.length);
    expect(totals.find((t) => t.label === "Redistribuição")).toMatchObject({ costUsd: 0, byRule: 1 });
    for (let i = 1; i < totals.length; i++) expect(totals[i - 1]!.costUsd).toBeGreaterThanOrEqual(totals[i]!.costUsd);
  });

  it("as execuções da demo mantêm a empresa abaixo do limite", () => {
    const s = budgetStatus(totalCost([...DAY_RUNS]));
    expect(s.level).toBe("normal");
    expect(s.spentUsd).toBeLessThan(BUDGET.monthlyLimitUsd * 0.8);
  });

  it("ids das execuções são únicos", () => {
    const ids = DAY_RUNS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("formatUsd", () => {
  it("usa vírgula decimal e mais casas só para valores muito pequenos", async () => {
    const { formatUsd } = await import("./runs");
    expect(formatUsd(12.5)).toBe("US$ 12,50");
    expect(formatUsd(0.0012)).toBe("US$ 0,0012");
    expect(formatUsd(0)).toBe("US$ 0,00");
  });
});
