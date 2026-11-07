import { describe, expect, it } from "vitest";
import { buildDemo, DEMO_IDS, localDate } from "./demo.ts";

// Noite em Fortaleza (03:12), manhã em Joanesburgo: o momento da cena 1.
const now = new Date("2026-11-07T06:12:00Z");
const demo = buildDemo(now);
const P = DEMO_IDS.people;

describe("empresa de demonstração", () => {
  it("tem as sete personas, todas na empresa de demonstração", () => {
    expect(demo.people.map((p) => p.name).sort()).toEqual(["Bruno", "Carla", "Eduardo", "Fernando", "Marina", "Rita", "Yan"]);
    const rows = Object.values(demo).flat() as { orgId?: string | null; id?: string }[];
    for (const row of rows) {
      if ("orgId" in row) expect(row.orgId).toBe(DEMO_IDS.org);
    }
    expect(demo.orgs[0]?.isDemo).toBe(true);
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
