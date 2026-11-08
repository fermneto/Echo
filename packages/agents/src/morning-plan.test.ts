// Plano da manhã (etapa 9): por regra, até 7 itens na mensagem, privado, reordenar e descartar só pela pessoa.
import type { OutboxAction } from "@echo/actions";
import { DAY, FixedClock, HOUR, type Person, type PlanFinding, type PlanItem, type PlanQuestion, type PullRequest, type Task } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import type { AgentData } from "./data.ts";
import { createMorningPlan, type PlanStore, type StoredPlan } from "./morning-plan.ts";

const NOW = new Date("2026-11-09T11:45:00Z"); // segunda, 08h45 em Fortaleza
const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "org", name, role: "member", timezone: "America/Fortaleza", workHours: hours, skills: [], areas: [], active: true, ...extra });
const people = [person("fernando", "Fernando Neto"), person("eduardo", "Eduardo"), person("carla", "Carla"), person("rita", "Rita", { role: "hr" })];

function setup(opts: { tasks?: Task[]; questions?: PlanQuestion[]; findings?: PlanFinding[] } = {}) {
  const plans = new Map<string, StoredPlan>();
  const outbox: OutboxAction[] = [];
  const recorder = new LogRunRecorder();
  const prs: PullRequest[] = [{ id: "p34", repository: "r/app", number: 34, title: "t", authorId: "carla", state: "open", branch: "b34", files: [], reviewerIds: ["fernando"], openedAt: new Date(NOW.getTime() - 2 * DAY) }];
  const store: PlanStore = {
    questionsForOwner: async () => opts.questions ?? [{ id: "q1", askerId: "eduardo", createdAt: new Date(NOW.getTime() - 6 * HOUR), subject: "ech-128-tempo-limite" }],
    findingsForAuthor: async () => opts.findings ?? [],
    fixesForAuthor: async () => [],
    get: async (p, d) => plans.get(`${p}:${d}`) ?? null,
    create: async (plan) => (plans.has(`${plan.personId}:${plan.date}`) ? false : (plans.set(`${plan.personId}:${plan.date}`, plan), true)),
    updateItems: async (p, d, items) => { const x = plans.get(`${p}:${d}`); if (!x) return false; plans.set(`${p}:${d}`, { ...x, items }); return true; },
    slackUserOf: async (p) => (p === "fernando" ? "U-FER" : null),
  };
  const data = { people: async () => people, pullRequests: async () => prs, tasks: async () => opts.tasks ?? [], absences: async () => [] } as unknown as AgentData;
  const flow = createMorningPlan({
    data: () => data,
    plans: () => store,
    outbox: () => ({ enqueue: async (a) => { const dup = outbox.some((x) => x.idempotencyKey === a.idempotencyKey); if (!dup) outbox.push(a); return { id: a.idempotencyKey, duplicate: dup }; } }),
    recorder,
    clock: new FixedClock(NOW),
    webUrl: "https://echo.test",
  });
  return { flow, plans, outbox, runs: recorder.runs };
}

describe("plano da manhã", () => {
  it("monta por regra, guarda e manda em privado com até 7 itens e 'mais no painel'", async () => {
    const tasks: Task[] = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, key: `ECH-2${i}`, title: "x", assigneeId: "fernando", state: "todo", dueDate: "2026-11-10", labels: [], hasLinearId: true }));
    const { flow, plans, outbox, runs } = setup({ tasks });
    const r = await flow.build("org", "fernando", "2026-11-09");
    expect(r).toMatchObject({ status: "created", dmQueued: true });
    const plan = plans.get("fernando:2026-11-09")!;
    expect(plan.items).toHaveLength(10);
    expect(plan.items.slice(0, 2).map((i) => i.kind)).toEqual(["review_request", "question"]);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: "slack.dm", target: "person:fernando", payload: { personId: "fernando" }, idempotencyKey: "morning_plan:fernando:2026-11-09" });
    const text = (outbox[0]!.payload as { text: string }).text;
    expect(text.split("\n")[0]).toBe("*Seu plano de hoje*");
    expect(text).toContain("• *PR 34 de Carla espera sua revisão* — revisão pedida a você, há 2 dias");
    // Prazo aparece na agenda, não repete como pendência.
    expect(text.match(/^• /gm)).toHaveLength(2);
    expect(text).toContain("fazer ECH-20: x (prazo 10/11)");
    const all = JSON.stringify((outbox[0]!.payload as { blocks: unknown[] }).blocks);
    expect(all).toContain("AGENDA DO DIA");
    expect(all).toContain("Agente de Fernando");
    expect(all).toContain("Hoje, nesta ordem");
    expect(all).toContain("*Amanhã*");
    expect(all).toContain("Esperam você");
    expect(runs[0]).toMatchObject({ flow: "morning_plan", result: "ok", tools: ["slack.dm"] });
    expect(runs[0]!.model).toBeUndefined();
  });

  it("prazo de tarefa fora da agenda continua como pendência", async () => {
    const tasks: Task[] = [{ id: "r", key: "ECH-9", title: "x", assigneeId: "fernando", state: "in_review", dueDate: "2026-11-05", labels: [], hasLinearId: true }];
    const { flow, outbox } = setup({ tasks });
    await flow.build("org", "fernando", "2026-11-09");
    expect((outbox[0]!.payload as { text: string }).text).toContain("• *ECH-9 passou do prazo*");
  });

  it("mostra até 7 pendências e o que espera outra entrega", async () => {
    const questions = Array.from({ length: 9 }, (_, i): PlanQuestion => ({ id: `q${i}`, askerId: "eduardo", createdAt: new Date(NOW.getTime() - i * HOUR) }));
    const tasks: Task[] = [{ id: "a", key: "ECH-1", title: "x", assigneeId: "fernando", state: "todo", labels: [], hasLinearId: true, blockedBy: ["ECH-2"] }, { id: "b", key: "ECH-2", title: "y", assigneeId: "carla", state: "todo", labels: [], hasLinearId: true }];
    const { flow, outbox } = setup({ questions, tasks });
    await flow.build("org", "fernando", "2026-11-09");
    const { text, blocks } = outbox[0]!.payload as { text: string; blocks: unknown[] };
    expect(text).toContain("E mais 3 no painel.");
    expect(JSON.stringify(blocks)).toContain("Esperando outra entrega");
    expect(JSON.stringify(blocks)).toContain("`ECH-1` espera `ECH-2` de Carla");
    expect(JSON.stringify(blocks)).toContain("Nenhuma tarefa na agenda.");
  });

  it("chave única por pessoa e data; RH sem plano; sem item, sem mensagem", async () => {
    const { flow, outbox } = setup();
    await flow.build("org", "fernando", "2026-11-09");
    expect(await flow.build("org", "fernando", "2026-11-09")).toMatchObject({ status: "skipped", reason: "plano já existe nesta data" });
    expect(await flow.build("org", "rita", "2026-11-09")).toMatchObject({ status: "skipped" });
    const empty = setup({ questions: [] });
    expect(await empty.flow.build("org", "eduardo", "2026-11-09")).toMatchObject({ status: "created", dmQueued: false });
    expect(empty.outbox).toEqual([]);
    expect(outbox).toHaveLength(1);
  });

  it("Meu plano: só a pessoa reordena e descarta", async () => {
    const { flow, plans } = setup({ tasks: [{ id: "t", key: "ECH-140", title: "x", assigneeId: "fernando", state: "todo", dueDate: "2026-11-11", labels: [], hasLinearId: true }] });
    await flow.build("org", "fernando", "2026-11-09");
    expect(await flow.edit("org", "eduardo", "fernando", "2026-11-09", { dismiss: ["question:q1"] })).toEqual({ status: "denied" });
    const r = await flow.edit("org", "fernando", "fernando", "2026-11-09", { order: ["due:ECH-140"], dismiss: ["question:q1"] });
    expect(r.status === "ok" && r.items.map((i: PlanItem) => i.id)).toEqual(["due:ECH-140", "review:r/app#34"]);
    expect(plans.get("fernando:2026-11-09")!.items).toHaveLength(2);
  });
});
