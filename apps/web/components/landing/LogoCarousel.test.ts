import { describe, expect, it } from "vitest";
import { distribute } from "./LogoCarousel";

describe("distribute", () => {
  it("a primeira leva são os primeiros itens, na ordem", () => {
    const cols = distribute(["GitHub", "Slack", "Linear", "Claude", "Jira", "Notion"], 4);
    expect(cols.map((c) => c[0])).toEqual(["GitHub", "Slack", "Linear", "Claude"]);
  });

  it("todas as colunas ficam do mesmo tamanho e todo item aparece", () => {
    const items = Array.from({ length: 19 }, (_, i) => `l${i}`);
    const cols = distribute(items, 4);
    expect(new Set(cols.map((c) => c.length)).size).toBe(1);
    expect(new Set(cols.flat())).toEqual(new Set(items));
  });
});
