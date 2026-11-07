// Ganhos (etapa 13): totais só com 3 ou mais pessoas, espera evitada pela volta gravada, medianas antes e
// depois por escopo e nenhum campo que identifique alguém.
import { describe, expect, it } from "vitest";
import { baselineFor, computeGains, gainsBaseline, type GainsInput, type GainsPerson, type GainsPr, median, parseGainsBaseline } from "./gains.ts";

const now = new Date("2026-11-07T12:00:00Z");
const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
const d = (n: number) => h(n * 24);

const people: GainsPerson[] = [
  { id: "fernando", teamId: "produto", active: true },
  { id: "eduardo", teamId: "produto", active: true },
  { id: "carla", teamId: "produto", active: true },
  { id: "yan", teamId: "dados", active: true },
  { id: "bruno", teamId: "dados", active: true },
  { id: "ex", teamId: "dados", active: false },
];

const base = (extra: Partial<GainsInput> = {}): GainsInput => ({ scope: { kind: "org" }, people, now, questions: [], pullRequests: [], fixes: [], coverage: [], baseline: null, ...extra });

describe("mediana", () => {
  it("ímpar, par e vazia", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("totais só com equipes de 3 ou mais pessoas", () => {
  it("equipe com 2 pessoas ativas não tem totais, mesmo com dados", () => {
    const r = computeGains(base({ scope: { kind: "team", teamId: "dados" }, questions: [{ ownerId: "yan", state: "answered", answeredAt: d(1), ownerReturnsAt: h(10) }] }));
    expect(r).toEqual({ status: "too_small", scope: { kind: "team", teamId: "dados" }, people: 2, min: 3 });
  });

  it("equipe com 3 pessoas ativas e a empresa têm totais", () => {
    expect(computeGains(base({ scope: { kind: "team", teamId: "produto" } })).status).toBe("ok");
    expect(computeGains(base()).status).toBe("ok");
  });

  it("empresa com menos de 3 pessoas também não", () => {
    expect(computeGains(base({ people: people.slice(0, 2) })).status).toBe("too_small");
  });

  it("nenhum campo traz id de pessoa", () => {
    const r = computeGains(base({ questions: [{ ownerId: "fernando", state: "answered", answeredAt: d(1), ownerReturnsAt: h(10), resolved: true }] }));
    const json = JSON.stringify(r);
    for (const p of people) expect(json).not.toContain(p.id);
  });
});

describe("espera evitada e resolveram", () => {
  it("soma da resposta até a volta gravada, só com o dono ausente e no período", () => {
    const r = computeGains(
      base({
        questions: [
          { ownerId: "fernando", state: "answered", answeredAt: h(30), ownerReturnsAt: h(24), resolved: true }, // 6 h
          { ownerId: "eduardo", state: "answered", answeredAt: h(5), ownerReturnsAt: h(2.5), resolved: false }, // 2,5 h
          { ownerId: "carla", state: "answered", answeredAt: h(3) }, // dono presente: sem volta gravada
          { ownerId: "carla", state: "failed", answeredAt: h(3), ownerReturnsAt: h(1) }, // falha não conta
          { ownerId: "fernando", state: "answered", answeredAt: d(40), ownerReturnsAt: d(39) }, // fora dos 30 dias
          { ownerId: "ex", state: "answered", answeredAt: h(3), ownerReturnsAt: h(1) }, // desligado
        ],
      }),
    );
    if (r.status !== "ok") throw new Error("esperava totais");
    expect(r.waitAvoided).toEqual({ hours: 8.5, answers: 2 });
    expect(r.resolved).toEqual({ yes: 1, no: 1, unrated: 1 });
  });

  it("custo por hora de espera evitada só no total da empresa", () => {
    const q = [{ ownerId: "fernando", state: "answered", answeredAt: h(30), ownerReturnsAt: h(20) }];
    const org = computeGains(base({ questions: q, costUsd: 5 }));
    const team = computeGains(base({ questions: q, costUsd: 5, scope: { kind: "team", teamId: "produto" } }));
    if (org.status !== "ok" || team.status !== "ok") throw new Error("esperava totais");
    expect(org.cost).toEqual({ usd: 5, perAvoidedHourUsd: 0.5 });
    expect(team.cost).toBeNull();
  });
});

describe("revisões antes e depois", () => {
  const pr = (authorId: string, openedDaysAgo: number, reviews: [string | undefined, number][], mergedDaysAgo?: number, analysisHours?: number): GainsPr => ({
    authorId,
    openedAt: d(openedDaysAgo),
    ...(mergedDaysAgo !== undefined ? { mergedAt: d(mergedDaysAgo) } : {}),
    reviews: reviews.map(([personId, hoursAfter]) => ({ ...(personId ? { personId } : {}), at: new Date(d(openedDaysAgo).getTime() + hoursAfter * 3_600_000) })),
    ...(analysisHours !== undefined ? { firstAnalysisAt: new Date(d(openedDaysAgo).getTime() + analysisHours * 3_600_000) } : {}),
  });

  it("primeira revisão humana ignora o autor e contas sem pessoa; idas e voltas até a união", () => {
    const prs = [
      pr("fernando", 10, [["fernando", 1], [undefined, 2], ["carla", 4], ["eduardo", 30]], 8, 0.5),
      pr("carla", 6, [["eduardo", 10]], 5, 1.5),
      pr("eduardo", 3, [], undefined, 2.5),
    ];
    const r = computeGains(base({ pullRequests: prs }));
    if (r.status !== "ok") throw new Error("esperava totais");
    expect(r.firstReview).toEqual({ hours: 7, before: null, prs: 3 }); // mediana de 4 h e 10 h
    expect(r.reviewRounds).toEqual({ perPr: 1.5, before: null, prs: 2 }); // 2 e 1 revisões
    expect(r.firstAnalysis).toEqual({ hours: 1.5, prs: 3 });
  });

  it("referência medida para a empresa e para equipes com 3 ou mais pessoas", () => {
    const echoStart = d(20);
    const old = [pr("fernando", 60, [["carla", 20]], 58), pr("carla", 50, [["eduardo", 30], ["fernando", 40]], 45), pr("yan", 40, [["bruno", 2]], 39), pr("fernando", 5, [["carla", 1]])];
    const b = gainsBaseline(old, people, echoStart, now);
    expect(b.from).toBe(d(110).toISOString());
    expect(b.to).toBe(echoStart.toISOString());
    expect(b.org).toEqual({ prs: 3, firstReviewHours: 20, reviewRoundsPerPr: 1 });
    expect(b.teams).toEqual({ produto: { prs: 2, firstReviewHours: 25, reviewRoundsPerPr: 1.5 } }); // "dados" tem 2 ativas
    expect(parseGainsBaseline(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(baselineFor(b, { kind: "team", teamId: "dados" })).toBeNull();

    const r = computeGains(base({ scope: { kind: "team", teamId: "produto" }, baseline: b }));
    if (r.status !== "ok") throw new Error("esperava totais");
    expect(r.firstReview.before).toBe(25);
    expect(r.reviewRounds.before).toBe(1.5);
    expect(r.baseline).toMatchObject({ prs: 2 });
  });

  it("referência em formato antigo conta como ausente", () => {
    expect(parseGainsBaseline({ questionWaitHours: 9, firstReviewHours: 26 })).toBeNull();
    expect(parseGainsBaseline(null)).toBeNull();
  });
});

describe("correções e cobertura", () => {
  it("aproveitadas entre as preparadas; tarefas redistribuídas e mediana até a aprovação", () => {
    const r = computeGains(
      base({
        fixes: [
          { authorId: "fernando", state: "approved", createdAt: d(2) },
          { authorId: "carla", state: "applied", createdAt: d(3) },
          { authorId: "eduardo", state: "declined", createdAt: d(4) },
          { authorId: "eduardo", state: "failed", createdAt: d(4) },
        ],
        coverage: [
          { absentId: "bruno", itemsMoved: 3, createdAt: d(10), approvedAt: new Date(d(10).getTime() + 2 * 3_600_000) },
          { absentId: "yan", itemsMoved: 2, createdAt: d(5), approvedAt: new Date(d(5).getTime() + 6 * 3_600_000) },
          { absentId: "carla", itemsMoved: 4, createdAt: d(1) }, // ainda sem aprovação
        ],
      }),
    );
    if (r.status !== "ok") throw new Error("esperava totais");
    expect(r.fixes).toEqual({ prepared: 3, approved: 2 });
    expect(r.coverage).toEqual({ tasks: 5, approvalHours: 4, plans: 3 });
  });
});
