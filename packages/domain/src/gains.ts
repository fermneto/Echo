// Ganhos (etapa 13, F10). Regras puras: recebem `now`, sem relógio, rede nem modelo.
// A tela mostra só totais da empresa ou de equipes com ao menos 3 pessoas, nunca uma pessoa.
// Antes e depois é comparação, não prova de causa.
import { DAY, HOUR } from "./time.ts";

export const GAINS_RULES = {
  /** Período da tela. */
  windowDays: 30,
  /** Referência: os 90 dias de GitHub antes do Echo, medidos uma vez. */
  baselineDays: 90,
  /** Abaixo disto, o total identificaria pessoas: a tela não mostra. */
  minPeople: 3,
  /** Correção que conta como preparada e, entre elas, como aproveitada. */
  fixPrepared: ["ready", "approved", "applied", "declined", "rejected"],
  fixApproved: ["approved", "applied"],
  /** Item de redistribuição que mudou de dono. */
  coverageItem: ["approved", "done"],
} as const;

const round1 = (n: number) => Math.round(n * 10) / 10;
const hours = (ms: number) => ms / HOUR;

/** Mediana (média dos dois do meio quando a quantidade é par). Sem valores, null. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------- Entradas (sem texto de pergunta, sem nome)

export interface GainsQuestion {
  ownerId?: string | undefined;
  state: string;
  answeredAt?: Date | undefined;
  ownerReturnsAt?: Date | undefined;
  /** Botões Resolveu (true) e Não resolveu (false), só de quem perguntou. */
  resolved?: boolean | null | undefined;
}

export interface GainsPr {
  authorId?: string | undefined;
  openedAt?: Date | undefined;
  mergedAt?: Date | undefined;
  /** Revisões no PR. `personId` vazio = conta não ligada ou robô: não é revisão humana conhecida. */
  reviews: { personId?: string | undefined; at: Date }[];
  /** Primeira análise automática do Echo. */
  firstAnalysisAt?: Date | undefined;
}

export interface GainsFix {
  authorId?: string | undefined;
  state: string;
  createdAt: Date;
}

export interface GainsCoverage {
  /** Quem saiu (dono original das tarefas). */
  absentId: string;
  itemsMoved: number;
  createdAt: Date;
  approvedAt?: Date | undefined;
}

export interface BaselineMedians {
  prs: number;
  firstReviewHours: number | null;
  reviewRoundsPerPr: number | null;
}

export interface GainsBaseline {
  /** ISO. Quando a referência foi medida (uma vez). */
  capturedAt: string;
  /** ISO. Período medido: 90 dias antes do início do Echo. */
  from: string;
  to: string;
  /** Empresa inteira e cada equipe com ao menos 3 pessoas, pelo autor do PR. */
  org: BaselineMedians;
  teams: Record<string, BaselineMedians>;
}

// ---------- Medidas de PR (usadas no período e na referência)

/** Primeira revisão de alguém que não é o autor, com conta ligada. */
function firstHumanReview(pr: GainsPr): Date | undefined {
  return pr.reviews
    .filter((r) => r.personId && r.personId !== pr.authorId && (!pr.openedAt || r.at.getTime() >= pr.openedAt.getTime()))
    .map((r) => r.at)
    .sort((a, b) => a.getTime() - b.getTime())[0];
}

/** Revisões humanas até a união. */
function roundsUntilMerge(pr: GainsPr): number | undefined {
  if (!pr.mergedAt) return undefined;
  return pr.reviews.filter((r) => r.personId && r.personId !== pr.authorId && r.at.getTime() <= pr.mergedAt!.getTime()).length;
}

function within(at: Date | undefined, from: Date, to: Date): at is Date {
  return !!at && at.getTime() >= from.getTime() && at.getTime() < to.getTime();
}

/** Mediana até a primeira revisão humana (PRs abertos no período) e de revisões até a união (PRs unidos no período). */
export function prMedians(prs: readonly GainsPr[], from: Date, to: Date): { firstReviewHours: number | null; reviewRoundsPerPr: number | null; prs: number; merged: number } {
  const opened = prs.filter((p) => within(p.openedAt, from, to));
  const waits = opened.flatMap((p) => {
    const first = firstHumanReview(p);
    return first ? [hours(first.getTime() - p.openedAt!.getTime())] : [];
  });
  const merged = prs.filter((p) => within(p.mergedAt, from, to));
  const rounds = merged.flatMap((p) => {
    const r = roundsUntilMerge(p);
    return r === undefined ? [] : [r];
  });
  const fr = median(waits);
  const rr = median(rounds);
  return { firstReviewHours: fr === null ? null : round1(fr), reviewRoundsPerPr: rr === null ? null : round1(rr), prs: opened.length, merged: merged.length };
}

/** Início do Echo e o período da referência: os 90 dias antes. */
export function baselinePeriod(echoStart: Date): { from: Date; to: Date } {
  return { from: new Date(echoStart.getTime() - GAINS_RULES.baselineDays * DAY), to: echoStart };
}

/**
 * Referência dos 90 dias antes do Echo, a partir do histórico do GitHub. Medida uma vez, para a empresa e
 * para cada equipe com ao menos 3 pessoas ativas (equipe menor não tem totais).
 */
export function gainsBaseline(prs: readonly GainsPr[], people: readonly GainsPerson[], echoStart: Date, now: Date): GainsBaseline {
  const { from, to } = baselinePeriod(echoStart);
  const medians = (scope: GainsScope): BaselineMedians => {
    const members = scopeMembers(scope, people);
    const m = prMedians(prs.filter((p) => !!p.authorId && members.has(p.authorId)), from, to);
    return { prs: m.prs, firstReviewHours: m.firstReviewHours, reviewRoundsPerPr: m.reviewRoundsPerPr };
  };
  const teams: Record<string, BaselineMedians> = {};
  for (const teamId of [...new Set(people.flatMap((p) => (p.teamId ? [p.teamId] : [])))].sort()) {
    if (scopeMembers({ kind: "team", teamId }, people).size >= GAINS_RULES.minPeople) teams[teamId] = medians({ kind: "team", teamId });
  }
  return { capturedAt: now.toISOString(), from: from.toISOString(), to: to.toISOString(), org: medians({ kind: "org" }), teams };
}

function parseMedians(raw: unknown): BaselineMedians | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : v === null ? null : undefined);
  const fr = numOrNull(b.firstReviewHours);
  const rr = numOrNull(b.reviewRoundsPerPr);
  if (typeof b.prs !== "number" || fr === undefined || rr === undefined) return null;
  return { prs: b.prs, firstReviewHours: fr, reviewRoundsPerPr: rr };
}

/** Lê a referência gravada em `orgs.gains_baseline`; formato antigo ou inválido conta como ausente. */
export function parseGainsBaseline(raw: unknown): GainsBaseline | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const org = parseMedians(b.org);
  if (typeof b.capturedAt !== "string" || typeof b.from !== "string" || typeof b.to !== "string" || !org) return null;
  const teams: Record<string, BaselineMedians> = {};
  if (b.teams && typeof b.teams === "object") {
    for (const [id, v] of Object.entries(b.teams as Record<string, unknown>)) {
      const m = parseMedians(v);
      if (m) teams[id] = m;
    }
  }
  return { capturedAt: b.capturedAt, from: b.from, to: b.to, org, teams };
}

/** A referência do escopo: a da empresa ou a da equipe (null se a equipe era pequena demais em 90 dias). */
export function baselineFor(baseline: GainsBaseline | null, scope: GainsScope): BaselineMedians | null {
  if (!baseline) return null;
  return scope.kind === "org" ? baseline.org : (baseline.teams[scope.teamId] ?? null);
}

// ---------- Totais

export type GainsScope = { kind: "org" } | { kind: "team"; teamId: string };

export interface GainsPerson {
  id: string;
  teamId?: string | undefined;
  active: boolean;
}

export interface GainsInput {
  scope: GainsScope;
  people: readonly GainsPerson[];
  now: Date;
  questions: readonly GainsQuestion[];
  pullRequests: readonly GainsPr[];
  fixes: readonly GainsFix[];
  coverage: readonly GainsCoverage[];
  /** Custo das execuções no período (só no total da empresa: agent_runs não tem pessoa). */
  costUsd?: number;
  baseline: GainsBaseline | null;
}

/** Só totais: nenhum campo identifica uma pessoa. */
export interface GainsTotals {
  status: "ok";
  scope: GainsScope;
  people: number;
  period: { from: Date; to: Date };
  /** Estimativa: da resposta até a volta prevista pela agenda do dono, gravada no momento. */
  waitAvoided: { hours: number; answers: number };
  resolved: { yes: number; no: number; unrated: number };
  firstReview: { hours: number | null; before: number | null; prs: number };
  reviewRounds: { perPr: number | null; before: number | null; prs: number };
  firstAnalysis: { hours: number | null; prs: number };
  fixes: { prepared: number; approved: number };
  coverage: { tasks: number; approvalHours: number | null; plans: number };
  /** Só no total da empresa. */
  cost: { usd: number; perAvoidedHourUsd: number | null } | null;
  baseline: { capturedAt: string; from: string; to: string; prs: number } | null;
}

export type GainsResult = GainsTotals | { status: "too_small"; scope: GainsScope; people: number; min: number };

/** Pessoas ativas no escopo (empresa inteira ou uma equipe). */
export function scopeMembers(scope: GainsScope, people: readonly GainsPerson[]): Set<string> {
  return new Set(people.filter((p) => p.active && (scope.kind === "org" || p.teamId === scope.teamId)).map((p) => p.id));
}

/**
 * Totais dos últimos 30 dias. Equipe (ou empresa) com menos de 3 pessoas ativas não tem totais, porque o
 * número diria o resultado de alguém. Perguntas contam pelo dono; PRs e correções pelo autor; cobertura
 * pela pessoa que saiu.
 */
export function computeGains(input: GainsInput): GainsResult {
  const members = scopeMembers(input.scope, input.people);
  if (members.size < GAINS_RULES.minPeople) return { status: "too_small", scope: input.scope, people: members.size, min: GAINS_RULES.minPeople };
  const to = input.now;
  const from = new Date(to.getTime() - GAINS_RULES.windowDays * DAY);
  const mine = (id: string | undefined) => !!id && members.has(id);

  // Espera evitada: só respostas dadas com o dono ausente e a volta gravada na hora.
  const answered = input.questions.filter((q) => mine(q.ownerId) && q.state === "answered" && within(q.answeredAt, from, to));
  const away = answered.filter((q) => q.ownerReturnsAt && q.ownerReturnsAt.getTime() > q.answeredAt!.getTime());
  const waitMs = away.reduce((s, q) => s + (q.ownerReturnsAt!.getTime() - q.answeredAt!.getTime()), 0);
  const waitHours = round1(hours(waitMs));

  const resolved = { yes: 0, no: 0, unrated: 0 };
  for (const q of answered) {
    if (q.resolved === true) resolved.yes++;
    else if (q.resolved === false) resolved.no++;
    else resolved.unrated++;
  }

  const prs = input.pullRequests.filter((p) => mine(p.authorId));
  const m = prMedians(prs, from, to);
  const analysed = prs.filter((p) => within(p.openedAt, from, to) && p.firstAnalysisAt && p.firstAnalysisAt.getTime() >= p.openedAt!.getTime());
  const analysis = median(analysed.map((p) => hours(p.firstAnalysisAt!.getTime() - p.openedAt!.getTime())));

  const fixes = input.fixes.filter((f) => mine(f.authorId) && within(f.createdAt, from, to));
  const prepared = fixes.filter((f) => (GAINS_RULES.fixPrepared as readonly string[]).includes(f.state));
  const approvedFixes = prepared.filter((f) => (GAINS_RULES.fixApproved as readonly string[]).includes(f.state));

  const plans = input.coverage.filter((c) => mine(c.absentId) && within(c.createdAt, from, to));
  const approvalWaits = plans.flatMap((c) => (c.approvedAt && c.approvedAt.getTime() >= c.createdAt.getTime() ? [hours(c.approvedAt.getTime() - c.createdAt.getTime())] : []));
  const approval = median(approvalWaits);

  const before = baselineFor(input.baseline, input.scope);
  const cost =
    input.scope.kind === "org" && input.costUsd !== undefined
      ? { usd: Math.round(input.costUsd * 100) / 100, perAvoidedHourUsd: waitHours > 0 ? Math.round((input.costUsd / waitHours) * 10_000) / 10_000 : null }
      : null;

  return {
    status: "ok",
    scope: input.scope,
    people: members.size,
    period: { from, to },
    waitAvoided: { hours: waitHours, answers: away.length },
    resolved,
    firstReview: { hours: m.firstReviewHours, before: before?.firstReviewHours ?? null, prs: m.prs },
    reviewRounds: { perPr: m.reviewRoundsPerPr, before: before?.reviewRoundsPerPr ?? null, prs: m.merged },
    firstAnalysis: { hours: analysis === null ? null : round1(analysis), prs: analysed.length },
    fixes: { prepared: prepared.length, approved: approvedFixes.length },
    coverage: { tasks: plans.filter((c) => c.approvedAt).reduce((s, c) => s + c.itemsMoved, 0), approvalHours: approval === null ? null : round1(approval), plans: plans.length },
    cost,
    baseline: input.baseline && before ? { capturedAt: input.baseline.capturedAt, from: input.baseline.from, to: input.baseline.to, prs: before.prs } : null,
  };
}
