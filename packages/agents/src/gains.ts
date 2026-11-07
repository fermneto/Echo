// Ganhos (etapa 13, F10). Sem modelo: a referência e os totais saem de `packages/domain`.
// `captureBaseline` mede 90 dias de GitHub uma vez; `get` entrega só totais, da empresa ou de equipes com 3 ou
// mais pessoas. A referência grava uma linha em agent_runs; a leitura da tela não é execução de agente.
import { type Clock, computeGains, DAY, GAINS_RULES, type GainsBaseline, gainsBaseline, type GainsCoverage, type GainsFix, type GainsPr, type GainsQuestion, type GainsResult, type GainsScope, parseGainsBaseline, systemClock } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import type { AgentData } from "./data.ts";

export interface GainsStore {
  /** Início do Echo na empresa: a primeira conta do GitHub ligada (ou a criação da empresa). */
  echoStart(): Promise<Date>;
  /** O que está em `orgs.gains_baseline`, sem interpretar. */
  baseline(): Promise<unknown>;
  /** Grava só se ainda não houver referência válida. False: alguém gravou antes. */
  saveBaselineOnce(b: GainsBaseline): Promise<boolean>;
  questions(since: Date): Promise<GainsQuestion[]>;
  pullRequests(since: Date): Promise<GainsPr[]>;
  fixes(since: Date): Promise<GainsFix[]>;
  coverage(since: Date): Promise<GainsCoverage[]>;
  teams(): Promise<{ id: string; name: string }[]>;
}

/** Histórico de PRs num período, com autores e revisores já ligados às pessoas da empresa. */
export interface GainsHistory {
  pullRequests(from: Date, to: Date): Promise<GainsPr[]>;
}

export interface GainsDeps {
  data: (orgId: string) => AgentData;
  store: (orgId: string) => GainsStore;
  recorder: RunRecorder;
  clock?: Clock;
}

export type BaselineOutcome = { status: "captured"; baseline: GainsBaseline } | { status: "skipped"; reason: string };

export interface GainsView {
  org: GainsResult;
  teams: { id: string; name: string; result: GainsResult }[];
}

export function createGains(deps: GainsDeps) {
  const clock = deps.clock ?? systemClock;
  const record = (run: AgentRun) => deps.recorder.record(run).catch(() => undefined);

  /** Referência dos 90 dias antes do Echo. Uma vez por empresa: se já existe, nada muda. */
  async function captureBaseline(orgId: string, history: GainsHistory | null): Promise<BaselineOutcome> {
    const started = performance.now();
    const done = async (o: BaselineOutcome, result: AgentRun["result"], error?: string) => {
      await record({ flow: "gains_baseline", orgId, durationMs: Math.round(performance.now() - started), result, tools: o.status === "captured" ? ["github.history"] : [], ...(error ? { error } : o.status === "skipped" ? { error: o.reason } : {}) });
      return o;
    };
    try {
      const store = deps.store(orgId);
      if (parseGainsBaseline(await store.baseline())) return done({ status: "skipped", reason: "referência já medida" }, "skipped");
      if (!history) return done({ status: "skipped", reason: "GitHub não ligado" }, "skipped");
      const now = clock.now();
      const start = await store.echoStart();
      const from = new Date(start.getTime() - GAINS_RULES.baselineDays * DAY);
      const [prs, people] = await Promise.all([history.pullRequests(from, start), deps.data(orgId).people()]);
      const baseline = gainsBaseline(prs, people, start, now);
      if (!(await store.saveBaselineOnce(baseline))) return done({ status: "skipped", reason: "referência já medida" }, "skipped");
      return done({ status: "captured", baseline }, "ok");
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await record({ flow: "gains_baseline", orgId, durationMs: Math.round(performance.now() - started), result: "failed", error });
      throw err;
    }
  }

  /** Totais dos últimos 30 dias: empresa e cada equipe (equipe com menos de 3 pessoas vem sem números). */
  async function get(orgId: string): Promise<GainsView> {
    const store = deps.store(orgId);
    const data = deps.data(orgId);
    const now = clock.now();
    const since = new Date(now.getTime() - GAINS_RULES.windowDays * DAY);
    // PRs abertos até 30 dias antes do período ainda podem ser unidos dentro dele.
    const prSince = new Date(since.getTime() - GAINS_RULES.windowDays * DAY);
    const [people, questions, pullRequests, fixes, coverage, costUsd, rawBaseline, teams] = await Promise.all([
      data.people(),
      store.questions(since),
      store.pullRequests(prSince),
      store.fixes(since),
      store.coverage(since),
      data.spentUsdSince(since),
      store.baseline(),
      store.teams(),
    ]);
    const baseline = parseGainsBaseline(rawBaseline);
    const compute = (scope: GainsScope) => computeGains({ scope, people, now, questions, pullRequests, fixes, coverage, costUsd, baseline });
    return {
      org: compute({ kind: "org" }),
      teams: [...teams].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map((t) => ({ ...t, result: compute({ kind: "team", teamId: t.id }) })),
    };
  }

  return { captureBaseline, get };
}

export type Gains = ReturnType<typeof createGains>;
