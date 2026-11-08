import { describe, expect, it } from "vitest";
import { addDays, isoWeek, weekMonday } from "@echo/domain";
import { buildDemo, DEMO_IDS, localDate } from "./demo.ts";

// Noite em Fortaleza (03:12), manhã em Joanesburgo: o momento da cena 1.
const now = new Date("2026-11-07T06:12:00Z");
const demo = buildDemo(now);
const P = DEMO_IDS.people;

describe("empresa de demonstração", () => {
  it("tem as sete personas e as outras pessoas do mapa, todas na empresa de demonstração", () => {
    const names = demo.people.map((p) => p.name);
    for (const n of ["Bruno", "Carla", "Eduardo", "Fernando", "Marina", "Rita", "Yan"]) expect(names).toContain(n);
    expect(names).toHaveLength(18);
    const rows = Object.values(demo).flat() as { orgId?: string | null; id?: string }[];
    for (const row of rows) {
      if ("orgId" in row) expect(row.orgId).toBe(DEMO_IDS.org);
    }
    expect(demo.orgs[0]?.isDemo).toBe(true);
  });

  it("três equipes, cada uma com líder; só o RH fica sem equipe", () => {
    expect(demo.teams.map((t) => t.name)).toEqual(["Produto", "Dados e plataforma", "Aplicativo e qualidade"]);
    for (const t of demo.teams) expect(demo.people.find((p) => p.id === t.leaderId)?.teamId).toBe(t.id);
    const semEquipe = demo.people.filter((p) => !p.teamId).map((p) => p.name);
    expect(semEquipe).toEqual(["Rita"]);
  });

  it("todos trabalham no fim de semana e folgam só na terça", () => {
    for (const p of demo.people) expect(p.workHours?.days).toEqual([0, 1, 3, 4, 5, 6]);
  });

  it("férias do mapa: Yan e Noah", () => {
    const names = demo.absences.map((a) => demo.people.find((p) => p.id === a.personId)?.name).sort();
    expect(names).toEqual(["Noah", "Yan"]);
    for (const a of demo.absences) expect(a.endsAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("relatórios enviados só das semanas anteriores, nunca do RH, sem aviso e fora da janela do vídeo", () => {
    expect(demo.weeklyReports.length).toBeGreaterThan(50);
    expect(new Set(demo.weeklyReports.map((r) => r.week)).size).toBe(7);
    // A semana que acabou de fechar fica para a conferência da pessoa (pnpm relatorio:agora, cena 4).
    const lastClosed = isoWeek(addDays(weekMonday(isoWeek(now.toISOString().slice(0, 10)))!, -7));
    expect(demo.weeklyReports.some((r) => r.week === lastClosed)).toBe(false);
    expect(demo.weeklyReports.some((r) => r.personId === P.rita)).toBe(false);
    for (const r of demo.weeklyReports) {
      expect(r.state).toBe("sent");
      expect(r.noticeAt).toBeUndefined();
      expect(r.sentAt!.getTime()).toBeLessThan(now.getTime() - 7 * 24 * 3_600_000);
      expect(new Date(r.coveredPeriod.to).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it("dá um papel por persona: Marina lidera, Rita é do RH", () => {
    const role = (id: string) => demo.people.find((p) => p.id === id)?.role ?? "member";
    expect(role(P.marina)).toBe("leader");
    expect(role(P.rita)).toBe("hr");
    expect(demo.teams[0]?.leaderId).toBe(P.marina);
  });

  it("cena 1: a nota confirmada de Fernando libera ech-131-api-v2 e reserva ech-128-tempo-limite", () => {
    const note = demo.dailyNotes.find((n) => n.personId === P.fernando);
    expect(note?.state).toBe("confirmed");
    expect(note?.date).toBe(localDate(new Date(now.getTime() - 86_400_000), "America/Fortaleza"));
    expect(note?.released?.map((r) => r.branch)).toEqual(["ech-131-api-v2"]);
    expect(note?.released?.[0]?.to).toBe(P.eduardo);
    expect(note?.reserved?.map((r) => r.branch)).toEqual(["ech-128-tempo-limite"]);
    expect(demo.pullRequests.find((p) => p.branch === "ech-128-tempo-limite")?.state).toBe("open");
  });

  it("cena 2: a nota 'Tempo limite nos pagamentos' existe para ser corrigida", () => {
    const note = demo.brainNotes.find((n) => n.path === "equipe/pagamentos/tempo-limite.md");
    expect(note?.content).toContain("Tempo limite nos pagamentos");
    expect(note?.content).toContain("5 segundos");
    expect(note?.visibility).toBe("team");
  });

  it("cena 3: Bruno passa do limite de carga e ECH-160 está sem responsável", () => {
    const bruno = demo.tasks.filter((t) => t.assigneeId === P.bruno && t.state !== "done");
    const sizes = bruno.reduce((s, t) => s + (t.size ?? 2), 0);
    const reviews = demo.pullRequests.filter((p) => p.state === "open" && p.reviewerIds?.includes(P.bruno)).length;
    expect(sizes + reviews * 0.5).toBeGreaterThan(demo.teams[0]?.loadLimit ?? 12);
    expect(bruno.map((t) => t.key)).toEqual(expect.arrayContaining(["ECH-133", "ECH-137"]));
    expect(demo.tasks.find((t) => t.key === "ECH-137")?.area).toBeUndefined();
    expect(demo.tasks.find((t) => t.key === "ECH-160")?.assigneeId).toBeUndefined();
  });

  it("cena 4: Carla tem poucos commits, nenhuma entrega na semana e 5 ajudas confirmadas", () => {
    const weekAgo = now.getTime() - 7 * 86_400_000;
    const carla = demo.workEvents.filter((e) => e.personId === P.carla && e.occurredAt.getTime() >= weekAgo);
    expect(carla.filter((e) => e.type === "commit").length).toBeLessThanOrEqual(2);
    expect(carla.filter((e) => e.type === "pr_merged")).toHaveLength(0);
    const helps = demo.contributions.filter((c) => c.helperId === P.carla && c.occurredAt.getTime() >= weekAgo);
    expect(helps).toHaveLength(5);
    expect(helps.every((c) => c.confirmed)).toBe(true);
  });

  it("respeita as chaves únicas do esquema", () => {
    const unique = (xs: string[]) => new Set(xs).size === xs.length;
    expect(unique(demo.tasks.map((t) => t.key))).toBe(true);
    expect(unique(demo.pullRequests.map((p) => `${p.repository}#${p.number}`))).toBe(true);
    expect(unique(demo.workEvents.map((e) => `${e.source}:${e.sourceRef}`))).toBe(true);
    expect(unique(demo.brainNotes.map((n) => n.path))).toBe(true);
    expect(unique(demo.identities.map((i) => `${i.platform}:${i.externalId}`))).toBe(true);
    expect(unique(demo.contributions.map((c) => `${c.source}:${c.sourceRef}:${c.helperId}`))).toBe(true);
  });

  it("referencia só pessoas que existem", () => {
    const ids = new Set(demo.people.map((p) => p.id));
    const refs = [
      ...demo.tasks.map((t) => t.assigneeId),
      ...demo.pullRequests.flatMap((p) => [p.authorId, ...(p.reviewerIds ?? [])]),
      ...demo.contributions.flatMap((c) => [c.helperId, c.helpedId]),
      ...demo.workEvents.map((e) => e.personId),
    ].filter((x): x is string => typeof x === "string");
    for (const r of refs) expect(ids.has(r)).toBe(true);
  });

  it("é determinística para o mesmo instante", () => {
    expect(buildDemo(now)).toEqual(demo);
  });
});
