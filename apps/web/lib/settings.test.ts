import { describe, expect, it } from "vitest";
import { navFor } from "./access";
import { accessMatrix, connectionRows, costSteps } from "./settings";

describe("configuração", () => {
  it("sem banco, nenhuma plataforma aparece como ligada", () => {
    const rows = connectionRows(null);
    expect(rows.map((r) => r.kind)).toEqual(["github", "slack", "linear", "jira", "google", "microsoft", "vercel"]);
    expect(rows.every((r) => r.state === "no_env" && r.status === "Não conectado neste ambiente")).toBe(true);
  });

  it("com banco, ligada é quem tem rota para a empresa", () => {
    const rows = connectionRows({ github: "123", slack: "T01", linear: null, jira: "acme.atlassian.net" });
    expect(Object.fromEntries(rows.map((r) => [r.kind, r.state]))).toEqual({ github: "on", slack: "on", linear: "off", jira: "on", google: "off", microsoft: "off", vercel: "off" });
  });

  it("a matriz de acesso segue as regras das rotas: o RH não vê notas, plano nem custo", () => {
    const m = Object.fromEntries(accessMatrix().map((a) => [a.route, a.roles]));
    expect(m.notas).toEqual({ member: true, leader: true, hr: false });
    expect(m.plano?.hr).toBe(false);
    expect(m.execucoes).toEqual({ member: false, leader: true, hr: false });
    expect(m.configuracao).toEqual({ member: false, leader: true, hr: true });
  });

  it("degraus do limite saem das regras fixas de custo", () => {
    expect(costSteps(60)).toEqual([
      { percent: 80, atUsd: 48, what: "Correções e vídeos param" },
      { percent: 100, atUsd: 60, what: "Só respostas por regra, sem modelo" },
      { percent: 200, atUsd: 120, what: "Ausentes respondem sem IA" },
    ]);
  });

  it("Configuração aparece no fim de Gestão para liderança e RH, e não para a equipe", () => {
    const gestao = (role: "member" | "leader" | "hr") => navFor(role, { demo: false }).find((g) => g.label === "Gestão")?.items.map((i) => i.href) ?? [];
    expect(gestao("leader").at(-1)).toBe("/configuracao");
    expect(gestao("hr").at(-1)).toBe("/configuracao");
    expect(gestao("member")).not.toContain("/configuracao");
  });
});
