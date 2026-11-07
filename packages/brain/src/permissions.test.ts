import { describe, expect, it } from "vitest";
import type { Viewer } from "./index.ts";
import { canSee, isCorrectionPath } from "./permissions.ts";

const fernando: Viewer = { personId: "fernando", role: "member", teamId: "produto" };
const eduardo: Viewer = { personId: "eduardo", role: "member", teamId: "produto" };
const marina: Viewer = { personId: "marina", role: "leader", teamId: "produto" };
const outroLider: Viewer = { personId: "zeca", role: "leader", teamId: "vendas" };
const rita: Viewer = { personId: "rita", role: "hr" };
const ofFernando = { teamId: "produto" };

describe("canSee", () => {
  it("privada: só a dona", () => {
    const note = { personId: "fernando", visibility: "private" as const };
    expect([fernando, eduardo, marina, rita].map((v) => canSee(v, note, ofFernando))).toEqual([true, false, false, false]);
  });

  it("da pessoa: a dona e a liderança da equipe dela", () => {
    const note = { personId: "fernando", visibility: "person" as const };
    expect([fernando, eduardo, marina, outroLider].map((v) => canSee(v, note, ofFernando))).toEqual([true, false, true, false]);
  });

  it("da equipe: a equipe da dona; nota sem dona vale para a empresa", () => {
    const note = { personId: "fernando", visibility: "team" as const };
    expect([eduardo, outroLider].map((v) => canSee(v, note, ofFernando))).toEqual([true, false]);
    expect(canSee(outroLider, { personId: undefined, visibility: "team" })).toBe(true);
  });

  it("o RH não lê cérebros, nem notas da equipe", () => {
    expect(canSee(rita, { personId: undefined, visibility: "team" })).toBe(false);
    expect(canSee({ ...rita, personId: "rita" }, { personId: "rita", visibility: "private" })).toBe(false);
  });

  it("quem não tem equipe não ganha acesso por acaso", () => {
    const semEquipe: Viewer = { personId: "x", role: "leader" };
    expect(canSee(semEquipe, { personId: "fernando", visibility: "person" }, { teamId: null })).toBe(false);
    expect(canSee(semEquipe, { personId: "fernando", visibility: "team" }, { teamId: null })).toBe(false);
  });
});

describe("isCorrectionPath", () => {
  it("reconhece correcoes/ em qualquer cérebro", () => {
    expect(isCorrectionPath("agente-fernando/correcoes/tempo-limite.md")).toBe(true);
    expect(isCorrectionPath("correcoes/x.md")).toBe(true);
    expect(isCorrectionPath("agente-fernando/decisoes/correcoes-antigas.md")).toBe(false);
  });
});
