import type { PersonWork } from "@echo/agents/painel";
import type { PullRequest, Task } from "@echo/domain";
import { describe, expect, it, vi } from "vitest";
import type { Persona } from "./demo/types";
import { loadProfile, profileFromWork, questionsFromWork } from "./person-live";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";
const people = [
  { id: ANA, name: "Ana Prado" },
  { id: BETO, name: "Beto Reis" },
];
const task = (over: Partial<Task> = {}): Task => ({ id: "t1", key: "PLA-7", title: "Fila de reenvio", state: "in_progress", labels: [], hasLinearId: true, assigneeId: ANA, ...over });
const pr = (over: Partial<PullRequest> = {}): PullRequest => ({ id: "p1", repository: "teste/app", number: 12, title: "Reenvio com espera", state: "open", branch: "pla-7-reenvio", files: [], reviewerIds: [], authorId: ANA, ...over });
const work = (over: Partial<PersonWork> = {}): PersonWork => ({ tasks: [], pullRequests: [], reviews: [], note: null, ...over });
const base = { work: [], notes: [], skills: [{ label: "Do perfil", items: ["Go"] }], tools: [], languages: ["inglês"] };

const persona = (over: Partial<Persona> = {}): Persona => ({
  id: ANA,
  orgId: "org-real",
  name: "Ana Prado",
  role: "member",
  timezone: "America/Fortaleza",
  workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
  skills: ["Go"],
  areas: [],
  active: true,
  title: "",
  story: "",
  city: "Fortaleza",
  cityCode: "FOR",
  registered: true,
  languages: ["inglês"],
  availability: { kind: "working" },
  ...over,
});

describe("ficha com o trabalho do banco", () => {
  it("tarefas, PRs e revisões pedidas viram a lista do que está fazendo; o perfil do banco fica", () => {
    const p = profileFromWork(base, work({ tasks: [task({ dueDate: "2026-11-20" })], pullRequests: [pr({ checksState: "failure" })], reviews: [pr({ number: 13, title: "Painel novo", authorId: BETO })] }), people);
    expect(p.work).toEqual([
      { title: "PLA-7 · Fila de reenvio", meta: "Em andamento · prazo 20/11" },
      { title: "PR 12 · Reenvio com espera", meta: "Aberto · pla-7-reenvio · testes falhando" },
      { title: "Revisão do PR 13, de Beto", meta: "Revisão pedida · Painel novo" },
    ]);
    expect(p.skills).toEqual(base.skills);
    expect(p.lastNote).toBeUndefined();
  });

  it("a última nota do dia entra com o que parou, travou, liberou e reservou", () => {
    const p = profileFromWork(base, work({ note: { personId: ANA, date: "2026-11-06", stoppedAt: "PR 12 aberto", blocked: "Testes falham", released: [{ branch: "pla-3", to: BETO }], reserved: [{ branch: "pla-7-reenvio" }], state: "confirmed" } }), people);
    expect(p.lastNote).toMatchObject({ date: "06/11", stoppedAt: "PR 12 aberto", blocked: ["Testes falham"] });
    expect(p.lastNote!.released[0]).toContain("pla-3");
    expect(p.lastNote!.released[0]).toContain("Beto");
    expect(p.lastNote!.reserved[0]).toContain("pla-7-reenvio");
  });

  it("perguntas sugeridas saem das tarefas e PRs reais; sem nada, só quando volta", () => {
    expect(questionsFromWork("Ana Prado", work({ tasks: [task({ key: "PLA-1", state: "todo" }), task()], pullRequests: [pr()], reviews: [pr({ number: 13 })], note: { personId: ANA, date: "2026-11-06", released: [], reserved: [], state: "confirmed" } }))).toEqual([
      "Onde Ana parou?",
      "Em que pé está a PLA-7?",
      "Posso mexer na branch pla-7-reenvio?",
      "Ana já revisou o PR 13?",
    ]);
    expect(questionsFromWork("Ana Prado", work())).toEqual(["Quando Ana volta?"]);
  });
});

describe("ficha para quem é de empresa conectada", () => {
  const me = persona({ id: BETO, name: "Beto Reis" });

  it("lê o trabalho e as notas da pessoa no banco da empresa, nunca o perfil da demo", async () => {
    const read = vi.fn(async () => work({ tasks: [task()] }));
    const notes = vi.fn(async () => [
      { ownerId: ANA, notes: [{ title: "Reenvio", tags: ["decisão"], versions: [{ n: 1, body: "antiga", by: "Ana", at: "05/11" }, { n: 2, body: "Espera de 30 s", by: "Ana", at: "06/11" }] }] },
      { ownerId: BETO, notes: [{ title: "Do Beto", tags: [], versions: [{ n: 1, body: "x", by: "Beto", at: "06/11" }] }] },
    ]);
    const view = await loadProfile(me, persona(), people, { read, notes });
    expect(read).toHaveBeenCalledWith("org-real", ANA);
    expect(view.profile.work).toEqual([{ title: "PLA-7 · Fila de reenvio", meta: "Em andamento" }]);
    expect(view.notes).toEqual([{ title: "Reenvio", excerpt: "Espera de 30 s", tags: ["decisão"] }]);
    expect(view.suggestions).toEqual(["Em que pé está a PLA-7?"]);
  });

  it("o RH não lê trabalho nem notas", async () => {
    const read = vi.fn(async () => work({ tasks: [task()] }));
    const view = await loadProfile(persona({ id: BETO, role: "hr" }), persona(), people, { read, notes: async () => [] });
    expect(read).not.toHaveBeenCalled();
    expect(view).toMatchObject({ notes: [], suggestions: [], profile: { work: [] } });
  });

  it("com falha na leitura, a ficha fica vazia em vez de cair na demonstração", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await loadProfile(me, persona(), people, { read: () => Promise.reject(new Error("fora do ar")), notes: async () => [] });
    expect(view).toMatchObject({ notes: [], suggestions: [], profile: { work: [] } });
    err.mockRestore();
  });

  it("a persona da demonstração continua com o perfil sintético", async () => {
    const demo = persona({ id: "fernando", orgId: "demo", name: "Fernando", registered: false });
    const read = vi.fn();
    const view = await loadProfile({ ...demo, id: "eduardo", name: "Eduardo" }, demo, people, { read, notes: async () => [] });
    expect(read).not.toHaveBeenCalled();
    expect(view.profile.focus).toMatch(/ECH-128/);
    expect(view.suggestions.some((q) => q.includes("ech-131"))).toBe(true);
  });
});
