import { describe, expect, it } from "vitest";
import { distribute } from "./LogoCarousel";

describe("distribute", () => {
  it("a primeira leva são os primeiros itens, na ordem", () => {
    const cols = distribute(["GitHub", "Slack", "Linear", "Claude", "Jira", "Notion"], 4);
    expect(cols.map((c) => c[0])).toEqual(["GitHub", "Slack", "Linear", "Claude"]);
  });

  it("todo item aparece uma vez só, sem repetir numa coluna", () => {
    const items = Array.from({ length: 19 }, (_, i) => `l${i}`);
    const cols = distribute(items, 4);
    expect(cols.flat()).toHaveLength(19);
    expect(new Set(cols.flat()).size).toBe(19);
    for (const c of cols) expect(new Set(c).size).toBe(c.length);
  });

  it("ao dar a volta, nenhuma coluna mostra o mesmo logo duas vezes seguidas", () => {
    const cols = distribute(Array.from({ length: 19 }, (_, i) => `l${i}`), 4);
    for (const c of cols) for (let step = 0; step < 40; step++) expect(c[step % c.length]).not.toBe(c[(step + 1) % c.length]);
  });
});
