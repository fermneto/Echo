import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./auth";

describe("safeReturnPath", () => {
  it("aceita só caminho interno do painel", () => {
    expect(safeReturnPath("/resumos?data=2026-11-07")).toBe("/resumos?data=2026-11-07");
    expect(safeReturnPath("/")).toBe("/");
    for (const bad of ["https://mal.example", "//mal.example", "/\\\\mal.example", "resumos", "/javascript:alert(1)", "", null, undefined, `/${"a".repeat(400)}`]) expect(safeReturnPath(bad)).toBeNull();
  });
});
