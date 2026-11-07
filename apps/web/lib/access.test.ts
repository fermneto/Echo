import { describe, expect, it } from "vitest";
import { canAskTwin, canSee, navFor, ROUTES, type RouteId } from "./access";

const demo = { demo: true };

describe("canSee", () => {
  it("RH nunca vê plano, nota do dia nem notas (cérebros)", () => {
    for (const r of ["plano", "notaDoDia", "notas"] as RouteId[]) expect(canSee("hr", r, demo)).toBe(false);
  });

  it("só a liderança vê redistribuição e custo e execuções", () => {
    for (const r of ["redistribuicao", "execucoes"] as RouteId[]) {
      expect(canSee("leader", r, demo)).toBe(true);
      expect(canSee("member", r, demo)).toBe(false);
      expect(canSee("hr", r, demo)).toBe(false);
    }
  });

  it("ganhos e configuração: RH e liderança, nunca a pessoa da equipe", () => {
    for (const r of ["ganhos", "configuracao"] as RouteId[]) {
      expect(canSee("hr", r, demo)).toBe(true);
      expect(canSee("leader", r, demo)).toBe(true);
      expect(canSee("member", r, demo)).toBe(false);
    }
  });

  it("simulador só existe na demonstração", () => {
    expect(canSee("member", "simulador", { demo: true })).toBe(true);
    expect(canSee("member", "simulador", { demo: false })).toBe(false);
  });

  it("toda rota tem ao menos um papel", () => {
    for (const def of Object.values(ROUTES)) expect(def.roles.length).toBeGreaterThan(0);
  });
});

describe("navFor", () => {
  it("RH não recebe o grupo Meu dia nem o link de Notas", () => {
    const nav = navFor("hr", demo);
    expect(nav.map((g) => g.label)).not.toContain("Meu dia");
    expect(nav.flatMap((g) => g.items.map((i) => i.href))).not.toContain("/notas");
  });

  it("sem demonstração, o grupo Demo some", () => {
    expect(navFor("leader", { demo: false }).map((g) => g.label)).not.toContain("Demo");
  });
});

describe("canAskTwin", () => {
  it("o RH não pergunta ao gêmeo; equipe e liderança sim", () => {
    expect(canAskTwin("hr")).toBe(false);
    expect(canAskTwin("member")).toBe(true);
    expect(canAskTwin("leader")).toBe(true);
  });
});
