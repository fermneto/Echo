// Bonequinho: traços de lista fechada, validação da saída do modelo e desenho por regra.
import { describe, expect, it } from "vitest";
import { AVATAR_LISTS, type AvatarTraits, avatarKey, composeEchoSprite, composeSprite, parseAvatarTraits, SPRITE_H, SPRITE_W, spriteCodes, traitsFromSeed } from "./avatar.ts";

const base: AvatarTraits = { hair: "short", hairColor: "brown", skin: "s3", eyewear: "none", facialHair: "none", top: "tshirt", topColor: "blue", headwear: "none" };

describe("parseAvatarTraits", () => {
  it("aceita só valores da lista e descarta campos a mais", () => {
    const { traits, rejected } = parseAvatarTraits({ ...base, hair: "afro", genero: "x", idade: 30 }, base);
    expect(traits).toEqual({ ...base, hair: "afro" });
    expect(rejected).toEqual([]);
    expect(Object.keys(traits).sort()).toEqual(Object.keys(AVATAR_LISTS).sort());
  });
  it("valor fora da lista volta ao padrão e é apontado", () => {
    const { traits, rejected } = parseAvatarTraits({ ...base, skin: "branca", topColor: "magenta" }, base);
    expect(traits.skin).toBe("s3");
    expect(traits.topColor).toBe("blue");
    expect(rejected).toEqual(["skin", "topColor"]);
  });
  it("saída que não é objeto: tudo do padrão", () => {
    expect(parseAvatarTraits("careca", base)).toEqual({ traits: base, rejected: Object.keys(AVATAR_LISTS) });
    expect(parseAvatarTraits(null, base).traits).toEqual(base);
  });
});

describe("traitsFromSeed", () => {
  it("é estável e sempre válido", () => {
    expect(traitsFromSeed("fernando")).toEqual(traitsFromSeed("fernando"));
    for (const seed of ["a", "b", "org:Maria", "0b9e…", ""]) expect(parseAvatarTraits(traitsFromSeed(seed), base).rejected).toEqual([]);
  });
});

describe("composeSprite", () => {
  it("16×24, com contorno e transparência", () => {
    const s = composeSprite(base);
    expect(s.width).toBe(SPRITE_W);
    expect(s.height).toBe(SPRITE_H);
    expect(s.pixels).toHaveLength(SPRITE_W * SPRITE_H);
    expect(s.pixels[0]).toBeNull();
    expect(s.pixels.every((c) => c === null || /^#[0-9a-f]{6}$/.test(c))).toBe(true);
  });
  it("corpo e rosto simétricos sem acessórios assimétricos", () => {
    const g = spriteCodes(base);
    for (const row of g) expect(row.join("")).toBe([...row].reverse().join(""));
  });
  it("cada traço muda o desenho", () => {
    const ref = JSON.stringify(composeSprite(base).pixels);
    for (const [k, list] of Object.entries(AVATAR_LISTS)) {
      const other = list.find((v) => v !== base[k as keyof AvatarTraits])!;
      expect(JSON.stringify(composeSprite({ ...base, [k]: other }).pixels), k).not.toBe(ref);
    }
  });
  it("o Echo é azul, com olhos acesos", () => {
    const echo = composeEchoSprite();
    expect(echo.pixels).toContain("#f4fbff");
    expect(echo.pixels).not.toContain("#e2a878");
  });
});

describe("avatarKey", () => {
  it("muda com qualquer traço e fica igual para os mesmos traços", () => {
    expect(avatarKey(base)).toBe(avatarKey({ ...base }));
    expect(avatarKey({ ...base, eyewear: "glasses" })).not.toBe(avatarKey(base));
    expect(avatarKey(base)).toMatch(/^1-[0-9a-z]{8}$/);
  });
});
