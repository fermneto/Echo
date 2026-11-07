import { describe, expect, it } from "vitest";
import { signedOffset, stepsForDrag } from "./CardStack";

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

describe("stepsForDrag", () => {
  it("arrastar para a esquerda um cartão avança um", () => {
    expect(stepsForDrag(-230, 230, 0)).toBe(1);
  });
  it("arrastar pouco volta para o mesmo cartão", () => {
    expect(stepsForDrag(-60, 230, 0)).toBe(0);
  });
  it("um empurrão rápido passa o cartão mesmo com arrasto curto", () => {
    expect(stepsForDrag(-60, 230, -1.2)).toBe(1);
  });
  it("arrastar dois cartões para a direita volta dois", () => {
    expect(stepsForDrag(470, 230, 0)).toBe(-2);
  });
});
