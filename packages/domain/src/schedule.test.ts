import { describe, expect, it } from "vitest";
import { assignCheck, onLeaveNow, personSchedule, scheduledKeys, scheduleDayLabel, taskPoints, workdays } from "./schedule.ts";
import type { Absence, Person, Task } from "./types.ts";

// Segunda, 09/11/2026, 12h UTC (9h em Fortaleza).
const now = new Date("2026-11-09T12:00:00Z");
const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "o", name, role: "member", teamId: "t", timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }, skills: [], areas: [], active: true, ...extra });
const yan = person("yan", "Yan Lemos");
const carla = person("carla", "Carla Souza");
const people = [yan, carla];
const task = (key: string, extra: Partial<Task> = {}): Task => ({ id: key, key, title: `Título ${key}`, assigneeId: "yan", state: "todo", labels: [], hasLinearId: true, size: 1, ...extra });
const plan = (tasks: Task[], extra: { absences?: Absence[]; pins?: Record<string, string> } = {}) => personSchedule({ person: yan, people, tasks, absences: extra.absences ?? [], now, ...(extra.pins ? { pins: extra.pins } : {}) });
const keysOf = (s: ReturnType<typeof plan>) => s.days.map((d) => d.entries.map((e) => e.key));

describe("agenda da pessoa", () => {
  it("usa só dias de trabalho e pula a ausência", () => {
    expect(workdays(yan, [], now)).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    const off: Absence = { personId: "yan", startsAt: new Date("2026-11-10T00:00:00Z"), endsAt: new Date("2026-11-12T03:00:00Z"), kind: "vacation" };
    expect(workdays(yan, [off], now)).toEqual(["2026-11-09", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"]);
  });

  it("em andamento primeiro, depois o prazo mais próximo, até o limite do dia", () => {
    const s = plan([task("A", { dueDate: "2026-11-20", size: 3 }), task("B", { state: "in_progress", size: 1 }), task("C", { dueDate: "2026-11-10", size: 2 })]);
    expect(keysOf(s).slice(0, 2)).toEqual([["B", "C"], ["A"]]);
    expect(s.days[0]!.points).toBe(3);
    expect(s.days[0]!.entries[0]!.reason).toBe("já em andamento");
  });

  it("tarefa maior que o dia se divide e não some", () => {
    const s = plan([task("G", { size: 5 })]);
    expect(s.days[0]!.entries[0]).toMatchObject({ key: "G", part: "inicia", points: 3 });
    expect(s.days[1]!.entries[0]).toMatchObject({ key: "G", part: "conclui", points: 2 });
  });

  it("dependência da própria pessoa termina antes", () => {
    const s = plan([task("A", { dueDate: "2026-11-10", size: 3, blockedBy: ["B"] }), task("B", { dueDate: "2026-11-30", size: 3 })]);
    expect(keysOf(s).slice(0, 2)).toEqual([["B"], ["A"]]);
    expect(s.days[1]!.entries[0]!.reason).toContain("depois da B");
  });

  it("dependência de outra pessoa conta a partir do prazo dela", () => {
    const s = plan([task("A", { blockedBy: ["X"] }), task("X", { assigneeId: "carla", dueDate: "2026-11-10" })]);
    expect(s.days[2]!.entries[0]).toMatchObject({ key: "A" });
    expect(s.days[2]!.entries[0]!.reason).toBe("depois da X de Carla, prazo 10/11");
  });

  it("sem previsão da outra entrega, fica esperando e não ganha dia", () => {
    const s = plan([task("A", { blockedBy: ["X"] }), task("X", { assigneeId: "carla" })]);
    expect(keysOf(s).flat()).toEqual([]);
    expect(s.waiting).toEqual([{ key: "A", title: "Título A", waitingOn: [{ key: "X", owner: "Carla" }], pinned: false }]);
  });

  it("dependência concluída não segura mais", () => {
    const s = plan([task("A", { blockedBy: ["FEITA"] })]);
    expect(keysOf(s)[0]).toEqual(["A"]);
  });

  it("dependência circular não trava a agenda", () => {
    const s = plan([task("A", { blockedBy: ["B"] }), task("B", { blockedBy: ["A"] }), task("C")]);
    expect(keysOf(s)[0]).toEqual(["C"]);
    expect(s.waiting.map((w) => w.key)).toEqual(["A", "B"]);
  });

  it("diz quem é liberado e avisa quando não dá tempo", () => {
    const s = plan([task("A", { dueDate: "2026-11-09", size: 8 }), task("Z", { assigneeId: "carla", blockedBy: ["A"] })]);
    const first = s.days[0]!.entries[0]!;
    expect(first.late).toBe(true);
    expect(first.reason).toBe("não termina até o prazo de 09/11, libera Z de Carla");
  });

  it("o que libera mais gente vem antes, com o mesmo prazo", () => {
    const s = plan([task("A", { dueDate: "2026-11-11", size: 3 }), task("B", { dueDate: "2026-11-11", size: 3 }), task("Z", { assigneeId: "carla", blockedBy: ["B"] })]);
    expect(keysOf(s).slice(0, 2)).toEqual([["B"], ["A"]]);
  });

  it("o dia escolhido pela pessoa vale, mas não fura dependência", () => {
    const moved = plan([task("A", { size: 1 }), task("B", { size: 1 })], { pins: { A: "2026-11-11" } });
    expect(keysOf(moved)).toEqual([["B"], [], ["A"], [], []]);
    expect(moved.days[2]!.entries[0]).toMatchObject({ pinned: true, reason: "dia escolhido por você" });
    const blocked = plan([task("A", { blockedBy: ["X"] }), task("X", { assigneeId: "carla", dueDate: "2026-11-11" })], { pins: { A: "2026-11-10" } });
    expect(blocked.days[3]!.entries[0]!.key).toBe("A");
    expect(blocked.days[1]!.entries).toEqual([]);
  });

  it("dia escolhido que já passou não segura a tarefa", () => {
    expect(keysOf(plan([task("A")], { pins: { A: "2026-11-02" } }))[0]).toEqual(["A"]);
  });

  it("o que não cabe no horizonte fica para depois; em revisão não ocupa o dia", () => {
    const s = plan([task("R", { state: "in_review", size: 3 }), ...Array.from({ length: 6 }, (_, i) => task(`T${i}`, { size: 3 }))]);
    expect(s.days.every((d) => d.points === 3)).toBe(true);
    expect(s.later.map((l) => l.key)).toEqual(["T5"]);
    expect(keysOf(s).flat()).not.toContain("R");
  });

  it("no mesmo dia, a dependência vem antes do que ela libera", () => {
    const s = plan([task("A", { dueDate: "2026-11-09", blockedBy: ["B"] }), task("B", { dueDate: "2026-11-30" })]);
    expect(keysOf(s)[0]).toEqual(["B", "A"]);
  });

  it("no mesmo dia, o que a pessoa escolheu vem primeiro", () => {
    const s = plan([task("A", { dueDate: "2026-11-09" }), task("B", { dueDate: "2026-11-30" })], { pins: { B: "2026-11-09" } });
    expect(keysOf(s)[0]).toEqual(["B", "A"]);
  });

  it("compromisso curto não tira o dia; só a ausência no expediente inteiro", () => {
    const curto: Absence = { personId: "yan", startsAt: new Date("2026-11-10T15:00:00Z"), endsAt: new Date("2026-11-10T16:00:00Z"), kind: "ooo" };
    expect(workdays(yan, [curto], now)).toContain("2026-11-10");
    const manha: Absence = { personId: "yan", startsAt: new Date("2026-11-10T12:00:00Z"), endsAt: new Date("2026-11-10T16:00:00Z"), kind: "ooo" };
    const tarde: Absence = { personId: "yan", startsAt: new Date("2026-11-10T16:00:00Z"), endsAt: new Date("2026-11-10T21:00:00Z"), kind: "ooo" };
    expect(workdays(yan, [manha, tarde], now)).not.toContain("2026-11-10");
  });

  it("dia escolhido e deslocado por dependência continua podendo voltar à sugestão", () => {
    const empurrada = plan([task("A", { blockedBy: ["X"] }), task("X", { assigneeId: "carla", dueDate: "2026-11-11" })], { pins: { A: "2026-11-10" } });
    expect(empurrada.days[3]!.entries[0]).toMatchObject({ key: "A", pinned: true });
    const parada = plan([task("A", { blockedBy: ["X"] }), task("X", { assigneeId: "carla" })], { pins: { A: "2026-11-10" } });
    expect(parada.waiting[0]).toMatchObject({ key: "A", pinned: true });
  });

  it("o que tem dia ou espera outra entrega está na agenda; em revisão não", () => {
    const s = plan([task("A"), task("B", { blockedBy: ["X"] }), task("X", { assigneeId: "carla" }), task("R", { state: "in_review" })]);
    expect([...scheduledKeys(s)].sort()).toEqual(["A", "B"]);
  });

  it("sem tamanho vale o ponto fixo das regras", () => {
    expect(taskPoints({})).toBe(2);
    expect(taskPoints({ size: 5 })).toBe(5);
  });

  it("rótulo do dia", () => {
    expect(["2026-11-09", "2026-11-10", "2026-11-11"].map((d) => scheduleDayLabel(d, "2026-11-09"))).toEqual(["Hoje", "Amanhã", "Quarta"]);
  });
});

describe("quem pode receber a tarefa", () => {
  const leader = person("lid", "Marina", { role: "leader" });
  const free = task("A", { assigneeId: undefined });
  it("compromisso curto e ausência inferida não bloqueiam a distribuição", () => {
    const at = { personId: "yan", startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000) };
    expect(onLeaveNow("yan", [{ ...at, kind: "ooo" }], now)).toBe(false);
    expect(onLeaveNow("yan", [{ ...at, kind: "vacation", inferred: true }], now)).toBe(false);
    expect(onLeaveNow("yan", [{ ...at, kind: "leave" }], now)).toBe(true);
  });
  it("liderança atribui na própria equipe", () => {
    expect(assignCheck({ leader, target: yan, task: free, absences: [], now })).toEqual({ ok: true });
  });
  it.each([
    ["membro", { leader: yan, target: carla }, "Só a liderança"],
    ["outra equipe", { target: person("x", "X", { teamId: "outra" }) }, "outra equipe"],
    ["RH", { target: person("r", "R", { role: "hr" }) }, "não recebe"],
    ["encerrada", { task: task("A", { state: "done", assigneeId: undefined }) }, "encerrada"],
    ["já tem responsável", { task: task("A") }, "já tem responsável"],
    ["já com outra equipe", { task: task("A", { assigneeId: "x" }) }, "já tem responsável"],
    ["ausente agora", { absences: [{ personId: "yan", startsAt: new Date(now.getTime() - 1000), endsAt: new Date(now.getTime() + 1000), kind: "vacation" as const }] }, "ausente"],
  ])("recusa: %s", (_, change, reason) => {
    const r = assignCheck({ leader, target: yan, task: free, absences: [], now, ...change });
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toContain(reason);
  });
});
