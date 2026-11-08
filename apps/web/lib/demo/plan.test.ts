import { describe, expect, it } from "vitest";
import { planFor } from "./plan";

describe("plano da manhã", () => {
  it("quem está esperando vem primeiro, e são no máximo 7 itens", () => {
    const p = planFor("fernando");
    expect(p[0]?.kind).toBe("esperando");
    expect(p.length).toBeLessThanOrEqual(7);
  });
});
