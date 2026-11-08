import { describe, expect, it } from "vitest";
import { hrOverview, recentWeeks, teamProgress } from "./hr-overview.ts";

const NOW = new Date("2026-11-08T12:00:00Z");
const m = (deliveries: number, reviews: number, helps: number) => ({ deliveries, reviews, helps });
const person = (id: string, teamId: string | undefined, extra: Partial<{ role: string; active: boolean }> = {}) => ({ id, teamId, role: "member", active: true, name: id.toUpperCase(), timezone: "America/Sao_Paulo", ...extra });

describe("semanas recentes", () => {
  it("da mais antiga à atual, atravessando o ano", () => {
    expect(recentWeeks("2026-11-08", 3)).toEqual(["2026-W43", "2026-W44", "2026-W45"]);
    expect(recentWeeks("2027-01-06", 2)).toEqual(["2026-W53", "2027-W01"]);
  });
});

describe("visão das equipes", () => {
  const teams = [
    { id: "p", name: "Produto" },
    { id: "d", name: "Dados" },
  ];
  const people = [person("a", "p"), person("b", "p"), person("c", "p"), person("rh", "p", { role: "hr" }), person("x", "p", { active: false }), person("d1", "d"), person("d2", "d")];
  const weeks = ["2026-W44", "2026-W45"];

  it("soma só relatórios enviados, por equipe e semana; a semana em destaque é a última com envio", () => {
    const v = hrOverview({
      teams,
      people,
      weeks,
      now: NOW,
      reports: [
        { personId: "a", week: "2026-W44", state: "sent", metrics: m(2, 1, 1) },
        { personId: "b", week: "2026-W44", state: "sent_without_notice", metrics: m(1, 3, 0) },
        { personId: "c", week: "2026-W44", state: "awaiting_owner", metrics: m(9, 9, 9) },
        { personId: "a", week: "2026-W40", state: "sent", metrics: m(9, 9, 9) },
        { personId: "x", week: "2026-W44", state: "sent", metrics: m(9, 9, 9) },
      ],
      twinAnswers: [
        { ownerId: "a", answeredAt: new Date("2026-11-03T02:00:00Z") }, // 2/11 à noite em São Paulo: W45
        { ownerId: "a", answeredAt: new Date("2026-11-02T02:00:00Z") }, // 1/11 (domingo) em São Paulo: W44
        { ownerId: "d1", answeredAt: new Date("2026-11-03T02:00:00Z") },
      ],
      absences: [
        { personId: "b", kind: "vacation", startsAt: new Date("2026-11-05T00:00:00Z"), endsAt: new Date("2026-11-14T00:00:00Z") },
        { personId: "c", kind: "vacation", startsAt: new Date("2026-11-20T00:00:00Z"), endsAt: new Date("2026-11-30T00:00:00Z") },
      ],
    });
    expect(v.focus).toBe("2026-W44");
    const [p, d] = v.teams;
    expect(p).toMatchObject({ status: "ok", people: 3, away: [{ name: "B", until: new Date("2026-11-14T00:00:00Z") }], progress: { total: 0, percent: 0 } });
    // O motivo da ausência (férias, licença) nunca chega ao RH.
    expect(JSON.stringify(p)).not.toContain("vacation");
    if (p?.status !== "ok") throw new Error("esperava totais");
    expect(p.weeks).toEqual([
      { week: "2026-W44", monday: "2026-10-26", deliveries: 3, reviews: 4, helps: 1, twins: 1, sent: 2 },
      { week: "2026-W45", monday: "2026-11-02", deliveries: 0, reviews: 0, helps: 0, twins: 1, sent: 0 },
    ]);
    // Equipe pequena demais: nenhum número, nem no total da empresa.
    expect(d).toEqual({ id: "d", name: "Dados", status: "too_small", people: 2, min: 3 });
    expect(v.total.map((w) => w.twins)).toEqual([1, 1]);
  });

  it("sem envio nenhum, a semana em destaque é a atual", () => {
    expect(hrOverview({ teams, people, weeks, now: NOW, reports: [], twinAnswers: [], absences: [] }).focus).toBe("2026-W45");
  });
});

describe("progresso da equipe", () => {
  const ids = new Set(["a", "b", "c"]);
  const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

  it("conta por estado e em pontos; ignora canceladas, concluídas antigas e quem não é da equipe", () => {
    const p = teamProgress(
      [
        { assigneeId: "a", state: "done", size: 3, updatedAt: at(2) },
        { assigneeId: "b", state: "done", updatedAt: at(10) }, // sem tamanho: vale 2
        { assigneeId: "c", state: "done", size: 5, updatedAt: at(20) }, // antiga: fora
        { assigneeId: "a", state: "in_review", size: 3, updatedAt: at(1) },
        { assigneeId: "b", state: "in_progress", size: 2, updatedAt: at(1) },
        { assigneeId: "c", state: "todo", size: 1, updatedAt: at(1) },
        { assigneeId: "c", state: "backlog", size: 1, updatedAt: at(1) },
        { assigneeId: "a", state: "canceled", size: 8, updatedAt: at(1) },
        { assigneeId: "z", state: "done", size: 8, updatedAt: at(1) },
        { state: "todo", size: 8, updatedAt: at(1) },
      ],
      ids,
      NOW,
    );
    expect(p).toEqual({ done: 2, review: 1, doing: 1, todo: 2, total: 6, points: { done: 5, total: 12 }, percent: 42 });
  });

  it("sem tarefa, zero por cento", () => {
    expect(teamProgress([], ids, NOW).percent).toBe(0);
  });
});
