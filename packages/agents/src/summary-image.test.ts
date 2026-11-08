// Render de verdade (satori + resvg): sai um PNG, com e sem modelo, e com texto acentuado.
import { buildDayFacts, defaultSpec } from "@echo/artifacts";
import { describe, expect, it } from "vitest";
import { renderSummaryPng } from "./summary-image.ts";

describe("renderSummaryPng", () => {
  it("gera um PNG do resumo", async () => {
    const day = buildDayFacts({
      pessoa: "Yan",
      date: "2026-11-07",
      parou: ["ECH-5 em andamento: falta a mensagem de erro do CPF"],
      travou: ["PR 12 aguarda revisão"],
      tarefas: [{ chave: "ECH-5", titulo: "Validação do formulário de cadastro", estado: "em andamento" }],
      prs: [{ numero: 12, titulo: "Validação de CPF", branch: "ech-5-cpf", rascunho: false }],
      atividade: [{ tipo: "tarefas", label: "Tarefas concluídas", value: 1 }],
      liberado: [],
      reservado: [{ branch: "ech-5-cpf", detail: "Até a revisão" }],
    });
    const png = await renderSummaryPng({ spec: defaultSpec(day), facts: day, state: "fallback" }, { stateLabel: "Resumo" });
    expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]);
    expect(png.length).toBeGreaterThan(20_000);
  }, 30_000);
});
