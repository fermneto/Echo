import { describe, expect, it } from "vitest";
import { signedOffset } from "./CardStack";

describe("signedOffset", () => {
  it("vizinhos ficam a ±1 do ativo", () => {
    expect(signedOffset(3, 2, 7)).toBe(1);
    expect(signedOffset(1, 2, 7)).toBe(-1);
  });

  it("dá a volta no fim da lista pelo caminho mais curto", () => {
    expect(signedOffset(0, 6, 7)).toBe(1);
    expect(signedOffset(6, 0, 7)).toBe(-1);
  });

  it("o ativo fica em 0", () => {
    expect(signedOffset(4, 4, 7)).toBe(0);
  });
});
