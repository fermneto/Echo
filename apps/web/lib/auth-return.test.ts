import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./auth";

describe("safeReturnPath", () => {
  it("aceita só caminho interno do painel", () => {
    expect(safeReturnPath("/resumos?data=2026-11-07")).toBe("/resumos?data=2026-11-07");
    expect(safeReturnPath("/")).toBe("/");
    for (const bad of ["https://mal.example", "//mal.example", "/\\\\mal.example", "resumos", "/javascript:alert(1)", "", null, undefined, `/${"a".repeat(400)}`]) expect(safeReturnPath(bad)).toBeNull();
  });

  it("recusa caractere de controle, que o navegador apaga da URL", () => {
    expect(new URL("/\t/mal.example", "https://echo.example").host).toBe("mal.example");
    for (const bad of ["/\t/mal.example", "/\n/mal.example", "/\r/mal.example", "/\u0000x", "/\u007f"]) expect(safeReturnPath(bad)).toBeNull();
  });
});
