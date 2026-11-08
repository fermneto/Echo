// Distribuição e agenda (sem modelo): atribuir sai pelo outbox com a aprovação da liderança, e só a pessoa muda o dia.
import type { OutboxAction } from "@echo/actions";
import { FixedClock, type Person, type Task } from "@echo/domain";
import { describe, expect, it } from "vitest";
import type { AgentData } from "./data.ts";
import { createWorkPlanning } from "./work-planning.ts";

const now = new Date("2026-11-09T12:00:00Z");
const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "org", name, role: "member", teamId: "t", timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }, skills: [], areas: [], active: true, ...extra });
const team = [person("marina", "Marina Dias", { role: "leader" }), person("yan", "Yan Lemos"), person("carla", "Carla Souza"), person("rita", "Rita", { role: "hr" }), person("x", "Xis", { teamId: "outra" })];
const task = (key: string, extra: Partial<Task> = {}): Task => ({ id: `id-${key}`, key, title: `Título ${key}`, state: "todo", labels: [], hasLinearId: true, size: 2, ...extra });

function setup(tasks: Task[]) {
  const outbox: OutboxAction[] = [];
  const runs: { flow: string; result: string; tools?: string[] }[] = [];
  const pins: Record<string, Record<string, string>> = {};
  const local: string[] = [];
  const accounts = { accounts: new Set(["marina", "yan", "carla"]) };
  const data = { people: async () => team, tasks: async () => tasks, absences: async () => [] } as unknown as AgentData;
  const flow = createWorkPlanning({
    data: () => data,
    store: () => ({ pins: async (id) => pins[id] ?? {}, setPins: async (id, p) => void (pins[id] = p), assignLocalTask: async (id, to) => void local.push(`${id}:${to}`), hasSlack: async (id) => id !== "carla", trackerAccounts: async () => accounts.accounts }),
    outbox: () => ({ enqueue: async (a) => (outbox.push(a), { id: "1", duplicate: false }) }),
    recorder: { record: async (r) => void runs.push(r as never) },
    clock: new FixedClock(now),
    webUrl: "https://echo.test/",
  });
  return { flow, outbox, runs, pins, local, store: accounts };
}

describe("distribuição de tarefas", () => {
  it("mesa da liderança: só a equipe, com carga, sem responsável e o dia em que entraria", async () => {
    const { flow } = setup([task("A", { assigneeId: "yan", size: 3 }), task("B", { dueDate: "2026-11-20", blockedBy: ["A"] }), task("C", { state: "in_progress" })]);
    const b = (await flow.board("org", "marina"))!;
    expect(b.people.map((p) => p.id)).toEqual(["marina", "yan", "carla"]);
    expect(b.people[1]).toMatchObject({ points: 3, capacity: 15, nextFree: "2026-11-10", today: [{ key: "A", title: "Título A" }] });
    expect(b.tasks.map((t) => t.key)).toEqual(["B"]);
    expect(b.tasks[0]!.blockedBy).toEqual([{ key: "A", owner: "Yan" }]);
    expect(b.tasks[0]!.starts).toEqual({ marina: null, yan: "2026-11-10", carla: null });
    expect(b.tasks[0]).toMatchObject({ suggestedId: "yan", points: 2, inTracker: true });
    expect(b.people[1]).toMatchObject({ localToday: "2026-11-09", hasTracker: true });
    expect(await flow.board("org", "yan")).toBeNull();
  });

  it("atribuir: tracker pelo outbox com a aprovação da liderança e aviso com o dia sugerido", async () => {
    const { flow, outbox, runs } = setup([task("B", { dueDate: "2026-11-20" })]);
    const r = await flow.assign("org", "marina", "B", "yan");
    expect(r).toEqual({ status: "queued", message: "B vai para Yan. Início sugerido: hoje, 09/11. A mudança está na fila para o tracker." });
    expect(outbox[0]).toMatchObject({ type: "linear.assign", target: "linear:B", payload: { taskKey: "B", toPersonId: "yan" }, approvedBy: "marina" });
    expect(outbox[1]).toMatchObject({ type: "slack.dm", target: "person:yan" });
    const dm = outbox[1]!.payload as { text: string; blocks: unknown[] };
    expect(dm.text).toBe("Marina passou B para você: Título B. Início sugerido: Hoje, 09/11 (prazo 20/11). Você pode mudar o dia em Meu plano.");
    expect(JSON.stringify(dm.blocks)).toContain("Agente de Yan");
    expect(runs[0]).toMatchObject({ flow: "task_assign", result: "ok", tools: ["linear.assign", "slack.dm"] });
  });

  it("não sugere nem atribui tarefa do tracker a quem não tem conta lá", async () => {
    const { flow, outbox, store } = setup([task("B")]);
    store.accounts = new Set(["marina", "carla"]);
    const b = (await flow.board("org", "marina"))!;
    expect(b.people.find((p) => p.id === "yan")!.hasTracker).toBe(false);
    expect(b.tasks[0]!.suggestedId).toBe("carla");
    expect(await flow.assign("org", "marina", "B", "yan")).toEqual({ status: "refused", reason: "Esta pessoa não tem conta no tracker de tarefas." });
    expect(outbox).toEqual([]);
  });

  it("não tira tarefa de quem já é responsável", async () => {
    const { flow, outbox } = setup([task("B", { assigneeId: "x", state: "in_progress" })]);
    expect((await flow.assign("org", "marina", "B", "yan")).status).toBe("refused");
    expect(outbox).toEqual([]);
  });

  it("tarefa sem tracker muda só no Echo; sem Slack, sem aviso", async () => {
    const { flow, outbox, local } = setup([task("B", { hasLinearId: false })]);
    await flow.assign("org", "marina", "B", "carla");
    expect(local).toEqual(["id-B:carla"]);
    expect(outbox).toEqual([]);
  });

  it("recusa quem não é da liderança, outra equipe e tarefa inexistente, sem escrever nada", async () => {
    const { flow, outbox, runs } = setup([task("B")]);
    expect((await flow.assign("org", "yan", "B", "carla")).status).toBe("denied");
    expect((await flow.assign("org", "marina", "B", "x")).status).toBe("refused");
    expect((await flow.assign("org", "marina", "Z", "yan")).status).toBe("not_found");
    expect(outbox).toEqual([]);
    expect(runs).toHaveLength(3);
  });
});

describe("agenda", () => {
  it("só a pessoa muda o dia, para um dia de trabalho, e pode voltar à sugestão", async () => {
    const { flow, pins, runs } = setup([task("A", { assigneeId: "yan" })]);
    expect((await flow.move("org", "marina", "yan", "A", "2026-11-11")).status).toBe("denied");
    expect((await flow.move("org", "yan", "yan", "A", "2026-11-14")).status).toBe("refused");
    expect((await flow.move("org", "yan", "yan", "Z", "2026-11-11")).status).toBe("not_found");
    expect(await flow.move("org", "yan", "yan", "A", "2026-11-11")).toEqual({ status: "moved" });
    expect(pins.yan).toEqual({ A: "2026-11-11" });
    expect((await flow.schedule("org", "yan"))!.schedule.days[2]!.entries[0]).toMatchObject({ key: "A", pinned: true });
    await flow.move("org", "yan", "yan", "A", null);
    expect(pins.yan).toEqual({});
    expect(runs.at(-1)).toMatchObject({ flow: "schedule_move", result: "ok" });
  });

  it("RH não tem agenda", async () => {
    expect(await setup([]).flow.schedule("org", "rita")).toBeNull();
  });
});
