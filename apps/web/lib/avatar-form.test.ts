import { AVATAR_LISTS } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { readTraitsForm, TRAIT_FIELDS, traitOptions } from "./avatar-form";

describe("ajuste do bonequinho à mão", () => {
  it("cada traço da lista fechada tem rótulo em português", () => {
    expect(TRAIT_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(AVATAR_LISTS).sort());
    for (const f of TRAIT_FIELDS) {
      const opts = traitOptions(f.key);
      expect(opts.map((o) => o.value)).toEqual([...AVATAR_LISTS[f.key]]);
      for (const o of opts) expect(o.label, `${f.key}.${o.value}`).not.toBe(o.value);
    }
  });

  it("cor da roupa no feminino, sem barba por extenso", () => {
    expect(traitOptions("topColor").find((o) => o.value === "white")!.label).toBe("Branca");
    expect(traitOptions("facialHair")[0]!.label).toBe("Sem barba");
  });

  it("lê os oito campos como vieram", () => {
    const f = new FormData();
    f.append("hair", "afro");
    f.append("extra", "x");
    const r = readTraitsForm(f);
    expect(Object.keys(r).sort()).toEqual(Object.keys(AVATAR_LISTS).sort());
    expect(r.hair).toBe("afro");
    expect(r.skin).toBe("");
  });
});
