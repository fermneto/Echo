import { describe, expect, it } from "vitest";
import { budgetStatus, flowLabel, runCost, totalCost, totalsByFlow } from "./demo/runs";
import { actionLabel, auditFromRow, monthStart, refLabel, runFromRow, runsBoardFromDb, type RunRowIn, shortAt } from "./runs-db";

const TZ = "America/Sao_Paulo";
const at = new Date("2026-11-07T17:02:00Z");
const row = (over: Partial<RunRowIn> = {}): RunRowIn => ({
  id: "r1",
  flow: "answer",
  model: "claude-sonnet-5-5",
  inputTokens: 7400,
  outputTokens: 420,
  costUsd: "0.017250",
  durationMs: 4200,
  tools: ["get_daily_note"],
  result: "ok",
  error: null,
  createdAt: at,
  ...over,
});

describe("execuções do banco", () => {
  it("data curta no fuso da pessoa", () => {
    expect(shortAt(at, TZ)).toBe("07/11 14:02");
  });

  it("usa o cost_usd gravado em vez da tabela de preços", () => {
    const r = runFromRow(row(), TZ);
    expect(r).toMatchObject({ id: "r1", at: "07/11 14:02", flow: "answer", costUsd: 0.01725, result: "ok", what: "Respostas concluída" });
    expect(runCost(r)).toBeCloseTo(0.01725);
  });

  it("sem cost_usd, calcula pelos tokens; sem modelo, custa zero", () => {
    const priced = runFromRow(row({ costUsd: null }), TZ);
    expect(priced.costUsd).toBeUndefined();
    expect(runCost(priced)).toBeCloseTo((7400 * 2 + 420 * 10) / 1_000_000);
    const rule = runFromRow(row({ model: null, costUsd: null, inputTokens: null, outputTokens: null, tools: null, result: "fallback" }), TZ);
    expect(rule).toMatchObject({ inputTokens: 0, outputTokens: 0, tools: [], result: "fallback" });
    expect(runCost(rule)).toBe(0);
  });

  it("modelo desconhecido sem custo gravado não inventa preço", () => {
    expect(runCost(runFromRow(row({ model: "outro-modelo", costUsd: null }), TZ))).toBe(0);
  });

  it("pulada e falha mostram o motivo; resultado desconhecido não quebra", () => {
    expect(runFromRow(row({ result: "skipped", error: "limite do mês" }), TZ)).toMatchObject({ result: "skipped", what: "Respostas pulada: limite do mês" });
    expect(runFromRow(row({ result: "failed", error: "x".repeat(300) }), TZ).what.length).toBeLessThan(170);
    expect(runFromRow(row({ result: "estranho", error: "boom" }), TZ).result).toBe("failed");
    expect(runFromRow(row({ result: "estranho" }), TZ).result).toBe("ok");
  });

  it("fluxos sem rótulo próprio viram texto legível e somam com o principal", () => {
    expect(flowLabel("night_review_batch")).toBe("Revisão de PR");
    // Fluxos novos do worker têm nome em português, não o nome técnico.
    expect(flowLabel("team_video")).toBe("Vídeo da semana");
    expect(flowLabel("daily_artifact")).toBe("Resumo do dia (modelo aberto)");
    expect(flowLabel("reconcile_jira")).toBe("Reconciliação");
    expect(flowLabel("redistribution_approve")).toBe("Redistribuição");
    expect(flowLabel("novo_fluxo.teste")).toBe("Novo fluxo teste");
    expect(flowLabel("")).toBe("Outro");
    const totals = totalsByFlow([runFromRow(row({ flow: "pr_review" }), TZ), runFromRow(row({ id: "r2", flow: "night_review" }), TZ)]);
    expect(totals).toHaveLength(1);
    expect(totals[0]).toMatchObject({ label: "Revisão de PR", runs: 2 });
  });

  it("auditoria troca ids por nomes e ações por frases", () => {
    const names = { "p-1": "Fernando" };
    expect(auditFromRow({ id: "a1", actor: "person:p-1", action: "login:slack", target: "person:p-1", createdAt: at }, names, TZ)).toEqual({
      id: "a1",
      at: "07/11 14:02",
      actor: "Fernando",
      action: "entrou no painel pelo Slack",
      target: "Fernando",
    });
    expect(actionLabel("approve:linear.assign")).toBe("aprovou linear.assign");
    expect(actionLabel("algo.novo")).toBe("algo.novo");
    expect(refLabel("org:00000000-0000-4000-8000-000000000001", names)).toBe("a empresa");
    expect(refLabel("person:sumiu", names)).toBe("pessoa removida");
    expect(refLabel("echo:actions", names)).toBe("Echo");
  });

  it("o gasto mostrado no mês é o do banco, mesmo com execuções listadas", () => {
    const view = { runs: [row(), row({ id: "r2", costUsd: "0.5" })], audit: [], monthSpentUsd: 3, names: {} };
    const board = runsBoardFromDb(view, { timeZone: TZ });
    expect(board.runs).toHaveLength(2);
    expect(budgetStatus(totalCost(board.runs), board.spentBeforeUsd, 60).spentUsd).toBeCloseTo(3);
  });

  it("o mês começa no dia 1, em UTC", () => {
    expect(monthStart(at).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
