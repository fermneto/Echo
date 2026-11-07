import { describe, expect, it } from "vitest";
import { move, planFor } from "./plan";

describe("plano da manhã", () => {
  it("quem está esperando vem primeiro, e são no máximo 7 itens", () => {
    const p = planFor("fernando");
    expect(p[0]?.kind).toBe("esperando");
    expect(p.length).toBeLessThanOrEqual(7);
  });
  it("move troca vizinhos e não sai da lista", () => {
    expect(move(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(move(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});
