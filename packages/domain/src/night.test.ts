import { describe, expect, it } from "vitest";
import { applyPlanEdits, morningDue, morningPlan, type PrDiffSummary, reviewDecision } from "./night.ts";
import { DAY, HOUR } from "./time.ts";
import type { Person, PullRequest, Task } from "./types.ts";

const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "o", name, role: "member", timezone: "America/Fortaleza", workHours: hours, skills: [], areas: [], active: true, ...extra });
const diff = (files: [string, number][], extra: Partial<PrDiffSummary> = {}): PrDiffSummary => ({ headSha: "abc", files: files.map(([path, n]) => ({ path, additions: n, deletions: 0 })), totalChars: 1000, ...extra });

describe("reviewDecision", () => {
  it("pula rascunho, fechado, sem mudança e versão já revisada", () => {
    expect(reviewDecision({ state: "draft" }, diff([["a.ts", 3]]), [])).toEqual({ action: "skip", reason: "rascunho" });
    expect(reviewDecision({ state: "merged" }, diff([["a.ts", 3]]), [])).toEqual({ action: "skip", reason: "fechado" });
    expect(reviewDecision({ state: "open" }, diff([]), [])).toEqual({ action: "skip", reason: "sem_mudanca" });
    expect(reviewDecision({ state: "open" }, diff([["a.ts", 0]]), [])).toEqual({ action: "skip", reason: "sem_mudanca" });
    expect(reviewDecision({ state: "open" }, diff([["a.ts", 3]]), ["abc"])).toEqual({ action: "skip", reason: "ja_revisado" });
  });

  it("grande demais: arquivos, linhas ou tamanho do diff", () => {
    expect(reviewDecision({ state: "open" }, diff(Array.from({ length: 81 }, (_, i) => [`f${i}.ts`, 1] as [string, number])), [])).toMatchObject({ action: "too_large" });
    expect(reviewDecision({ state: "open" }, diff([["a.ts", 3001]]), [])).toMatchObject({ action: "too_large", reason: "3001 linhas alteradas (limite 3000)" });
    expect(reviewDecision({ state: "open" }, diff([["a.ts", 10]], { totalChars: 300_001 }), [])).toMatchObject({ action: "too_large" });
  });

  it("Sonnet por padrão; Opus para caminho sensível ou PR grande", () => {
    expect(reviewDecision({ state: "open" }, diff([["src/listagem.ts", 40]]), [])).toMatchObject({ action: "review", model: "sonnet" });
    expect(reviewDecision({ state: "open" }, diff([["src/pagamentos/cliente.ts", 40]]), [])).toMatchObject({ action: "review", model: "opus" });
    expect(reviewDecision({ state: "open" }, diff([["db/migrations/0003.sql", 5]]), [])).toMatchObject({ model: "opus" });
    expect(reviewDecision({ state: "open" }, diff([["src/a.ts", 1200]]), [])).toMatchObject({ model: "opus" });
  });
});

describe("morningDue", () => {
  const fernando = person("f", "Fernando");
  it("de 30 min antes do expediente até 2 h depois do início, no fuso da pessoa", () => {
    // Segunda, 09/11/2026: 09h em Fortaleza = 12h UTC.
    expect(morningDue(fernando, [], new Date("2026-11-09T11:29:00Z"))).toBeNull();
    expect(morningDue(fernando, [], new Date("2026-11-09T11:30:00Z"))).toEqual({ date: "2026-11-09", startsAt: new Date("2026-11-09T12:00:00Z") });
    expect(morningDue(fernando, [], new Date("2026-11-09T14:00:00Z"))).toBeNull();
    expect(morningDue(fernando, [], new Date("2026-11-08T11:45:00Z"))).toBeNull(); // domingo
  });
  it("Tóquio: o expediente de segunda começa no domingo em UTC", () => {
    const kenji = person("k", "Kenji", { timezone: "Asia/Tokyo" });
    expect(morningDue(kenji, [], new Date("2026-11-08T23:45:00Z"))?.date).toBe("2026-11-09");
  });
  it("de férias, sem plano: espera a volta", () => {
    const vacation = [{ personId: "f", startsAt: new Date("2026-11-06T00:00:00Z"), endsAt: new Date("2026-11-13T00:00:00Z"), kind: "vacation" as const }];
    expect(morningDue(fernando, vacation, new Date("2026-11-09T11:45:00Z"))).toBeNull();
  });
});

describe("morningPlan", () => {
  const now = new Date("2026-11-09T11:45:00Z"); // segunda, 08h45 em Fortaleza
  const people = [person("fernando", "Fernando Neto"), person("eduardo", "Eduardo"), person("carla", "Carla")];
  const pr = (number: number, extra: Partial<PullRequest>): PullRequest => ({ id: `p${number}`, repository: "r/app", number, title: "t", state: "open", branch: `b${number}`, files: [], reviewerIds: [], ...extra });
  const task = (key: string, dueDate: string, extra: Partial<Task> = {}): Task => ({ id: key, key, title: key, assigneeId: "fernando", state: "in_progress", dueDate, labels: [], hasLinearId: true, ...extra });
  const input = {
    person: people[0]!,
    people,
    now,
    questions: [{ id: "q1", askerId: "eduardo", createdAt: new Date(now.getTime() - 6 * HOUR), subject: "ech-128-tempo-limite" }],
    pullRequests: [
      pr(34, { authorId: "carla", reviewerIds: ["fernando"], openedAt: new Date(now.getTime() - 2 * DAY) }),
      pr(44, { authorId: "fernando", checksState: "failure", openedAt: new Date(now.getTime() - 3 * DAY) }),
      pr(50, { authorId: "carla", reviewerIds: ["eduardo"] }),
    ],
    tasks: [task("ECH-140", "2026-11-12"), task("ECH-128", "2026-11-06"), task("ECH-150", "2026-11-30"), task("ECH-151", "2026-11-10", { state: "done" })],
    findings: [{ reviewId: "rv1", pr: { repository: "r/app", number: 44 }, severity: "alta" as const, count: 2 }],
  };

  it("quem espera, depois prazo, depois gravidade, com motivo por regra", () => {
    const { items, more } = morningPlan(input);
    expect(items.map((i) => `${i.text} — ${i.reason}`)).toEqual([
      "PR 34 de Carla espera sua revisão — revisão pedida a você, há 2 dias",
      "Eduardo deixou uma pergunta sobre ech-128-tempo-limite e está esperando — pergunta que precisa de você, desde ontem ou hoje",
      "ECH-128 passou do prazo — prazo era 06/11",
      "Prazo da ECH-140 é quinta — prazo em até 3 dias",
      "CI vermelha no seu PR 44 — checagens falharam na última versão",
      "Análise automática do seu PR 44: 2 achados — gravidade mais alta: alta",
      "Seu PR 44 está sem revisor — aberto há 3 dias",
    ]);
    expect(more).toBe(0);
  });

  it("até 7 itens, com o resto em 'ver mais'; descartado fica fora", () => {
    const many = { ...input, tasks: Array.from({ length: 9 }, (_, i) => task(`ECH-2${i}`, "2026-11-10")) };
    const r = morningPlan(many);
    expect(r.items).toHaveLength(7);
    expect(r.more).toBe(9 + 5 - 7);
    expect(morningPlan({ ...input, dismissed: ["review:r/app#34"] }).items[0]!.kind).toBe("question");
  });

  it("reordenar e descartar em Meu plano", () => {
    const { items } = morningPlan(input);
    const edited = applyPlanEdits(items, { order: ["due:ECH-140", "nao-existe"], dismiss: ["ci:r/app#44"] });
    expect(edited[0]!.id).toBe("due:ECH-140");
    expect(edited.map((i) => i.id)).not.toContain("ci:r/app#44");
    expect(edited).toHaveLength(6);
  });
});
