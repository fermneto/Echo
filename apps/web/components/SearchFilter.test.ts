import { describe, expect, it } from "vitest";
import { matches, normalize } from "./SearchFilter";

describe("busca", () => {
  it("ignora acento e maiúsculas", () => {
    expect(normalize("Inês Lisboa")).toBe("ines lisboa");
    expect(matches("Inês · Engenheira de qualidade · Lisboa", "ines")).toBe(true);
  });
  it("exige todas as palavras, em qualquer ordem", () => {
    expect(matches("Fernando Desenvolvedor Fortaleza", "fortaleza fernando")).toBe(true);
    expect(matches("Fernando Desenvolvedor Fortaleza", "fernando tóquio")).toBe(false);
  });
  it("busca vazia mostra tudo", () => {
    expect(matches("qualquer coisa", "  ")).toBe(true);
  });
});
