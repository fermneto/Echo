// Ganhos (etapa 13, F10): referência medida uma vez, totais só de empresa e equipes com 3 ou mais pessoas.
import { FixedClock, type GainsBaseline, type GainsPr, type Person } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import type { AgentData } from "./data.ts";
import { createGains, type GainsStore } from "./gains.ts";

const NOW = new Date("2026-11-07T12:00:00Z");
const DAY = 86_400_000;
const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, teamId: string): Person => ({ id, orgId: "org", name: id, role: "member", teamId, timezone: "America/Sao_Paulo", workHours: hours, skills: [], areas: [], active: true });
const people = [person("fernando", "produto"), person("eduardo", "produto"), person("carla", "produto"), person("yan", "dados"), person("bruno", "dados")];

function setup(opts: { baseline?: unknown } = {}) {
  let baseline: unknown = opts.baseline ?? null;
  const recorder = new LogRunRecorder();
  const store: GainsStore = {
    echoStart: async () => new Date(NOW.getTime() - 20 * DAY),
    baseline: async () => baseline,
    saveBaselineOnce: async (b) => {
      if (baseline && typeof baseline === "object" && "org" in baseline) return false;
      baseline = b;
      return true;
    },
    questions: async () => [{ ownerId: "fernando", state: "answered", answeredAt: new Date(NOW.getTime() - 2 * DAY), ownerReturnsAt: new Date(NOW.getTime() - 2 * DAY + 6 * 3_600_000), resolved: true }],
    pullRequests: async () => [],
    fixes: async () => [],
    coverage: async () => [],
    teams: async () => [
      { id: "produto", name: "Produto" },
      { id: "dados", name: "Dados" },
    ],
  };
  const data = { people: async () => people, spentUsdSince: async () => 3 } as unknown as AgentData;
  const flow = createGains({ data: () => data, store: () => store, recorder, clock: new FixedClock(NOW) });
  return { flow, runs: recorder.runs, saved: () => baseline };
}

const history = (prs: GainsPr[]) => {
  const calls: [Date, Date][] = [];
  return { calls, source: { pullRequests: async (from: Date, to: Date) => (calls.push([from, to]), prs) } };
};

describe("referência dos ganhos", () => {
  it("mede os 90 dias antes do Echo uma vez e grava uma linha em agent_runs", async () => {
    const { flow, runs, saved } = setup();
    const h = history([{ authorId: "fernando", openedAt: new Date(NOW.getTime() - 50 * DAY), reviews: [{ personId: "carla", at: new Date(NOW.getTime() - 50 * DAY + 26 * 3_600_000) }] }]);
    const r = await flow.captureBaseline("org", h.source);
    expect(r.status).toBe("captured");
    expect(h.calls[0]).toEqual([new Date(NOW.getTime() - 110 * DAY), new Date(NOW.getTime() - 20 * DAY)]);
    expect((saved() as GainsBaseline).org).toEqual({ prs: 1, firstReviewHours: 26, reviewRoundsPerPr: null });
    expect(runs[0]).toMatchObject({ flow: "gains_baseline", result: "ok" });

    // Segunda vez: nada muda, nem consulta o GitHub.
    expect(await flow.captureBaseline("org", h.source)).toEqual({ status: "skipped", reason: "referência já medida" });
    expect(h.calls).toHaveLength(1);
  });

  it("sem GitHub ligado, espera", async () => {
    const { flow, saved } = setup();
    expect(await flow.captureBaseline("org", null)).toEqual({ status: "skipped", reason: "GitHub não ligado" });
    expect(saved()).toBeNull();
  });
});

describe("tela Ganhos", () => {
  it("mostra totais da empresa e de equipes com 3 ou mais pessoas; equipe menor vem sem números", async () => {
    const { flow } = setup();
    const v = await flow.get("org");
    expect(v.org).toMatchObject({ status: "ok", people: 5, waitAvoided: { hours: 6, answers: 1 }, resolved: { yes: 1, no: 0, unrated: 0 }, cost: { usd: 3, perAvoidedHourUsd: 0.5 } });
    expect(v.teams.map((t) => [t.name, t.result.status])).toEqual([
      ["Dados", "too_small"],
      ["Produto", "ok"],
    ]);
    expect(JSON.stringify(v)).not.toContain("fernando");
  });
});
