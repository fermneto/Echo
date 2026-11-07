// Roda os casos de validator-cases.ts contra o validador da frente Funções.
// Enquanto `validateAnswer` não existir em @echo/agents, só os próprios casos são conferidos.
import { describe, expect, it } from "vitest";
import * as agents from "@echo/agents";
import { answerOutputSchema, type AnswerValidator } from "@echo/agents";
import { VALIDATOR_CASES } from "./validator-cases.ts";

const validate = (agents as { validateAnswer?: AnswerValidator }).validateAnswer;

describe("casos do validador", () => {
  it.each(VALIDATOR_CASES.map((c) => [c.name, c] as const))("%s segue o contrato de saída", (_, c) => {
    expect(answerOutputSchema.safeParse(c.out).success).toBe(true);
  });

  it("os nomes dos casos são únicos", () => {
    const names = VALIDATOR_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe.skipIf(!validate)("validateAnswer", () => {
  it.each(VALIDATOR_CASES.map((c) => [c.name, c] as const))("%s", (_, c) => {
    const codes = validate!(c.out, c.ctx).map((i) => i.code);
    if (c.expect.length === 0) expect(codes).toEqual([]);
    else expect(codes).toEqual(expect.arrayContaining(c.expect));
  });
});
