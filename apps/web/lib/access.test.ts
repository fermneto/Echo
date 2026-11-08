import { describe, expect, it } from "vitest";
import { canAskTwin, canEditProfile, canLinkAccounts, canSee, canSeePerson, navFor, ROUTES, visibleTeamIds, type RouteId } from "./access";
import { TEAM } from "./demo/team";
import { TEAMS } from "./demo/teams";

const demo = { demo: true };

describe("canSee", () => {
  it("RH nunca vê plano, nota do dia nem notas (cérebros)", () => {
    for (const r of ["plano", "notaDoDia", "resumo", "notas"] as RouteId[]) expect(canSee("hr", r, demo)).toBe(false);
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

  it("visão das equipes: só o RH", () => {
    expect(canSee("hr", "equipes", demo)).toBe(true);
    expect(canSee("leader", "equipes", demo)).toBe(false);
    expect(canSee("member", "equipes", demo)).toBe(false);
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

  it("não há grupo Demo no menu, nem na demonstração", () => {
    for (const demo of [true, false]) expect(navFor("leader", { demo }).map((g) => g.label)).not.toContain("Demo");
  });

  it("Meu dia traz o plano, a nota do dia e o resumo; o menu termina em Gestão", () => {
    const nav = navFor("member", demo);
    expect(nav.find((g) => g.label === "Meu dia")?.items.map((i) => i.href)).toEqual(["/plano", "/nota-do-dia", "/resumos"]);
    expect(nav.at(-1)?.label).toBe("Gestão");
  });
});

describe("canAskTwin", () => {
  it("o RH não pergunta ao gêmeo; equipe e liderança sim", () => {
    expect(canAskTwin("hr")).toBe(false);
    expect(canAskTwin("member")).toBe(true);
    expect(canAskTwin("leader")).toBe(true);
  });
});

describe("equipes visíveis", () => {
  const all = ["t1", "t2", "t3"];

  it("membro e liderança veem só a própria equipe", () => {
    expect(visibleTeamIds({ role: "member", teamId: "t2" }, all)).toEqual(["t2"]);
    expect(visibleTeamIds({ role: "leader", teamId: "t1" }, all, ["t1", "t2", "t3"])).toEqual(["t1"]);
  });

  it("RH vê as equipes que escolheu; sem escolha, todas; nunca equipe que não existe", () => {
    expect(visibleTeamIds({ role: "hr" }, all)).toEqual(all);
    expect(visibleTeamIds({ role: "hr" }, all, ["t3", "t1"])).toEqual(["t3", "t1"]);
    expect(visibleTeamIds({ role: "hr" }, all, [])).toEqual([]);
    expect(visibleTeamIds({ role: "hr" }, all, ["outra"])).toEqual([]);
  });

  it("empresa sem equipes cadastradas: quem não tem equipe vê todas", () => {
    expect(visibleTeamIds({ role: "member" }, all)).toEqual(all);
  });

  it("a pessoa sempre se vê; os outros, só se forem de uma equipe visível", () => {
    expect(canSeePerson({ id: "a" }, { id: "a" }, [])).toBe(true);
    expect(canSeePerson({ id: "a" }, { id: "b", teamId: "t1" }, ["t1"])).toBe(true);
    expect(canSeePerson({ id: "a" }, { id: "b", teamId: "t2" }, ["t1"])).toBe(false);
    expect(canSeePerson({ id: "a" }, { id: "rh" }, ["t1"])).toBe(false);
  });

  it("no mapa: Fernando vê só a equipe Produto; o RH que acompanha Dados vê só Dados", () => {
    const ids = TEAMS.map((t) => t.id);
    const fernando = TEAM.find((p) => p.id === "fernando")!;
    const produto = visibleTeamIds(fernando, ids);
    const seen = TEAM.filter((p) => canSeePerson(fernando, p, produto)).map((p) => p.id).sort();
    expect(seen).toEqual(["bruno", "carla", "eduardo", "fernando", "marina", "yan"]);
    const rita = TEAM.find((p) => p.id === "rita")!;
    const dados = visibleTeamIds(rita, ids, [TEAMS[1]!.id]);
    expect(TEAM.filter((p) => p.id !== "rita" && canSeePerson(rita, p, dados)).map((p) => p.id).sort()).toEqual(["amara", "ana", "jonas", "omar", "wei"]);
  });

  it("todas as pessoas do mapa, menos o RH, têm equipe, e todas folgam só na terça", () => {
    for (const p of TEAM) {
      if (p.role === "hr") expect(p.teamId).toBeUndefined();
      else expect(p.teamId).toBeTruthy();
      expect(p.workHours.days).toEqual([0, 1, 3, 4, 5, 6]);
    }
  });
});

describe("quem edita o perfil na ficha", () => {
  const target = { id: "p", teamId: "t1" };
  it("RH, liderança da equipe e a própria pessoa", () => {
    expect(canEditProfile({ id: "rh", role: "hr" }, target)).toBe(true);
    expect(canEditProfile({ id: "l", role: "leader", teamId: "t1" }, target)).toBe(true);
    expect(canEditProfile({ id: "p", role: "member", teamId: "t1" }, target)).toBe(true);
  });
  it("liderança de outra equipe ou colega, não", () => {
    expect(canEditProfile({ id: "l", role: "leader", teamId: "t2" }, target)).toBe(false);
    expect(canEditProfile({ id: "l", role: "leader" }, { id: "p" })).toBe(false);
    expect(canEditProfile({ id: "c", role: "member", teamId: "t1" }, target)).toBe(false);
  });
});

describe("quem liga as contas da pessoa", () => {
  const target = { id: "p", role: "member" as const, teamId: "t1" };
  it("RH e a liderança da equipe", () => {
    expect(canLinkAccounts({ id: "rh", role: "hr" }, target)).toBe(true);
    expect(canLinkAccounts({ id: "rh", role: "hr" }, { id: "rh2", role: "hr" })).toBe(true);
    expect(canLinkAccounts({ id: "l", role: "leader", teamId: "t1" }, target)).toBe(true);
  });
  it("a própria pessoa, colega, outra equipe ou alguém do RH pela liderança, não", () => {
    expect(canLinkAccounts({ id: "p", role: "member", teamId: "t1" }, target)).toBe(false);
    expect(canLinkAccounts({ id: "c", role: "member", teamId: "t1" }, target)).toBe(false);
    expect(canLinkAccounts({ id: "l", role: "leader", teamId: "t2" }, target)).toBe(false);
    expect(canLinkAccounts({ id: "l", role: "leader", teamId: "t1" }, { id: "rh", role: "hr", teamId: "t1" })).toBe(false);
  });
});
