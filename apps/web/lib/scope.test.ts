import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Persona } from "./demo/types";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const live = vi.hoisted(() => ({ teams: vi.fn(), team: vi.fn() }));
vi.mock("./team-live", () => ({ loadTeams: live.teams, loadTeam: live.team }));

const { scopeFrom, scopeLabel, teamScope } = await import("./scope");

const person = (id: string, over: Partial<Persona> = {}): Persona => ({
  id,
  orgId: "org-real",
  name: id,
  role: "member",
  timezone: "America/Fortaleza",
  workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
  skills: [],
  areas: [],
  active: true,
  title: "",
  story: "",
  city: "Fortaleza",
  cityCode: "FOR",
  availability: { kind: "working" },
  ...over,
});

const ana = person("ana", { teamId: "t1" });
const beto = person("beto", { teamId: "t1" });
const caio = person("caio", { teamId: "t2" });
const rita = person("rita", { role: "hr" });
const team = [ana, beto, caio, rita];
const names = (s: { people: Persona[] }) => s.people.map((p) => p.id);

describe("recorte da empresa conectada", () => {
  beforeEach(() => {
    live.teams.mockReset();
    live.team.mockReset().mockResolvedValue(team);
  });

  it("leitura das equipes falhou: só a própria pessoa, nunca a empresa toda", async () => {
    live.teams.mockResolvedValue(null);
    const s = await teamScope(ana);
    expect(live.teams).toHaveBeenCalledWith("org-real");
    expect(s).toEqual({ teams: [], visible: [], people: [ana], canChoose: false });
    expect(names(await teamScope(rita))).toEqual(["rita"]);
  });

  it("empresa sem equipes: todos se veem, menos o RH para os membros", async () => {
    live.teams.mockResolvedValue([]);
    expect(names(await teamScope(ana))).toEqual(["ana", "beto", "caio"]);
    expect(names(await teamScope(rita))).toEqual(["ana", "beto", "caio", "rita"]);
    expect((await teamScope(rita)).canChoose).toBe(false);
  });

  it("empresa com equipes: membro vê a própria; RH, todas", async () => {
    live.teams.mockResolvedValue([
      { id: "t1", name: "Plataforma" },
      { id: "t2", name: "Dados" },
    ]);
    expect(names(await teamScope(ana))).toEqual(["ana", "beto"]);
    expect(names(await teamScope(caio))).toEqual(["caio"]);
    const hr = await teamScope(rita);
    expect(names(hr)).toEqual(["ana", "beto", "caio", "rita"]);
    expect(hr.canChoose).toBe(true);
  });

  it("a equipe já carregada é usada sem nova leitura", async () => {
    live.teams.mockResolvedValue([{ id: "t1", name: "Plataforma" }]);
    expect(names(await teamScope(ana, [ana, caio]))).toEqual(["ana"]);
    expect(live.team).not.toHaveBeenCalled();
  });

  it("regra pura: RH com equipes escolhidas vê só essas", () => {
    expect(names(scopeFrom(rita, team, [{ id: "t1", name: "P" }, { id: "t2", name: "D" }], ["t2"]))).toEqual(["caio", "rita"]);
  });

  it("só o RH lê \"todas as equipes\"; membro e liderança leem o nome da própria", () => {
    const two = [{ id: "t1", name: "Plataforma" }, { id: "t2", name: "Dados" }];
    const one = [{ id: "t1", name: "Plataforma" }];
    expect(scopeLabel(scopeFrom(ana, team, one, null))).toBe("a equipe Plataforma");
    expect(scopeLabel(scopeFrom(ana, team, two, null))).toBe("a equipe Plataforma");
    expect(scopeLabel(scopeFrom(beto, team, two, null))).not.toContain("todas");
    expect(scopeLabel(scopeFrom(rita, team, two, null))).toBe("todas as equipes");
    expect(scopeLabel(scopeFrom(rita, team, two, ["t2"]))).toBe("a equipe Dados");
    expect(scopeLabel(scopeFrom(rita, team, two, []))).toBe("só a sua ficha");
  });

  it("sem equipes cadastradas ou com a leitura falhando, não diz \"todas as equipes\"", () => {
    expect(scopeLabel(scopeFrom(ana, team, [], null))).toBe("as pessoas da empresa, que ainda não tem equipes");
    expect(scopeLabel(scopeFrom(ana, team, null, null))).toBe("só a sua ficha");
  });
});
