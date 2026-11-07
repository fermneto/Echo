// Resumo da ausência (etapa 13): tipo por regra, linha única, início e fim do expediente com 3 h entre envios,
// férias esperando a volta e até 20 itens por seção.
import { describe, expect, it } from "vitest";
import { awayDigest, awayDigestDue, type DigestItem, digestKind, digestLine, digestPurgeBefore, digestSection } from "./away-digest.ts";
import type { Absence, Person } from "./types.ts";

const fernando: Person = { id: "fernando", orgId: "o", name: "Fernando", role: "member", timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }, skills: [], areas: [], active: true };

describe("tipo e linhas", () => {
  it("decisão, reunião, proposta ou nenhum, sem depender de acento", () => {
    expect(digestKind("Ficou decidido que a API v2 sai na sexta")).toBe("decisao");
    expect(digestKind("Podemos marcar uma reunião de alinhamento na quinta?")).toBe("reuniao");
    expect(digestKind("proponho trocar o timeout para 30 s")).toBe("proposta");
    expect(digestKind("Que tal adiar o deploy?")).toBe("proposta");
    expect(digestKind("posso seguir com a branch ech-131-api-v2?")).toBe("nenhum");
    expect(digestKind("REUNIAO amanha")).toBe("reuniao");
  });

  it("uma linha, sem menção nem formatação, cortada no limite", () => {
    expect(digestLine("<@U123> posso   seguir\ncom a *branch* `ech-131`?")).toBe("posso seguir com a branch ech-131?");
    expect(digestLine("<!here> veja <https://x.co/a|o plano> em <#C1|geral> e <https://y.co>")).toBe("veja o plano em #geral e https://y.co");
    const long = digestLine("a".repeat(300));
    expect(long).toHaveLength(140);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("agenda", () => {
  // Fortaleza é UTC−3: 09h = 12h UTC, 18h = 21h UTC. 09/11/2026 é segunda.
  it("no início e no fim do expediente, até 2 horas depois", () => {
    expect(awayDigestDue(fernando, [], new Date("2026-11-09T11:59:00Z"))).toBeNull();
    expect(awayDigestDue(fernando, [], new Date("2026-11-09T12:05:00Z"))).toEqual({ date: "2026-11-09", slot: "inicio" });
    expect(awayDigestDue(fernando, [], new Date("2026-11-09T14:00:00Z"))).toBeNull();
    expect(awayDigestDue(fernando, [], new Date("2026-11-09T21:30:00Z"))).toEqual({ date: "2026-11-09", slot: "fim" });
    expect(awayDigestDue(fernando, [], new Date("2026-11-08T12:05:00Z"))).toBeNull(); // domingo
  });

  it("pelo menos 3 horas entre envios", () => {
    const at = new Date("2026-11-09T21:30:00Z");
    expect(awayDigestDue(fernando, [], at, new Date("2026-11-09T19:00:00Z"))).toBeNull();
    expect(awayDigestDue(fernando, [], at, new Date("2026-11-09T18:30:00Z"))).toEqual({ date: "2026-11-09", slot: "fim" });
  });

  it("nas férias espera a volta; RH e inativos não recebem", () => {
    const vacation: Absence[] = [{ personId: "fernando", startsAt: new Date("2026-11-06T00:00:00Z"), endsAt: new Date("2026-11-10T03:00:00Z"), kind: "vacation" }];
    expect(awayDigestDue(fernando, vacation, new Date("2026-11-09T12:05:00Z"))).toBeNull();
    expect(awayDigestDue(fernando, vacation, new Date("2026-11-10T12:05:00Z"))).toEqual({ date: "2026-11-10", slot: "inicio" });
    expect(awayDigestDue({ ...fernando, role: "hr" }, [], new Date("2026-11-09T12:05:00Z"))).toBeNull();
    expect(awayDigestDue({ ...fernando, active: false }, [], new Date("2026-11-09T12:05:00Z"))).toBeNull();
  });
});

describe("agrupamento", () => {
  const item = (id: string, extra: Partial<DigestItem>): DigestItem => ({ id, kind: "nenhum", state: "answered", needsOwner: false, createdAt: new Date("2026-11-09T01:00:00Z"), ...extra });

  it("propostas e reuniões juntas; falha e 'não sei' sem resposta; o resto respondidas", () => {
    expect(digestSection({ kind: "reuniao", state: "silent", needsOwner: false })).toBe("propostas");
    expect(digestSection({ kind: "decisao", state: "answered", needsOwner: false })).toBe("decisoes");
    expect(digestSection({ kind: "nenhum", state: "failed", needsOwner: false })).toBe("sem_resposta");
    expect(digestSection({ kind: null, state: "answered", needsOwner: true })).toBe("sem_resposta");
    expect(digestSection({ kind: null, state: "answered", needsOwner: false })).toBe("respondidas");
  });

  it("quatro seções sempre na mesma ordem, até 20 itens em cada", () => {
    const many = Array.from({ length: 23 }, (_, i) => item(`r${i}`, { createdAt: new Date(Date.UTC(2026, 10, 9, 0, i)) }));
    const r = awayDigest([item("p", { kind: "reuniao" }), ...many]);
    expect(r.total).toBe(24);
    expect(r.sections.map((s) => [s.key, s.total, s.items.length])).toEqual([
      ["propostas", 1, 1],
      ["decisoes", 0, 0],
      ["sem_resposta", 0, 0],
      ["respondidas", 23, 20],
    ]);
    expect(r.sections[3]!.items[0]!.id).toBe("r0");
  });

  it("linhas com mais de 30 dias são apagadas", () => {
    expect(digestPurgeBefore(new Date("2026-11-09T12:00:00Z"))).toEqual(new Date("2026-10-10T12:00:00Z"));
  });
});
