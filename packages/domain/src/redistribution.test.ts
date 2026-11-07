// Redistribuição (etapa 11): ausência no fuso de quem se ausenta, candidatos pela calculadora, ajuste da
// líder com as regras do plano, plano complementar e devolução na volta.
import { describe, expect, it } from "vitest";
import { absenceRange, adjustmentCheck, canApprovePlan, canRegisterAbsence, complementTasks, planCandidates, returnProposals } from "./redistribution.ts";
import { planOptions } from "./rules.ts";
import type { Absence, Person, PullRequest, Task } from "./types.ts";

const NOW = new Date("2026-11-09T13:00:00Z");
const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "o", name: id[0]!.toUpperCase() + id.slice(1), role: "member", teamId: "produto", timezone: "America/Fortaleza", workHours: hours, skills: [], areas: [], active: true, ...extra });
const task = (key: string, extra: Partial<Task> = {}): Task => ({ id: key, key, title: key, state: "todo", labels: [], hasLinearId: true, ...extra });
const people = [
  person("bruno", { areas: ["pagamentos"] }),
  person("carla", { areas: ["pagamentos"] }),
  person("yan", { timezone: "Asia/Tokyo" }),
  person("marina", { role: "leader" }),
  person("rita", { role: "hr" }),
  person("outro", { teamId: "vendas" }),
];
const vacation = (personId: string, from: string, to: string): Absence => ({ personId, startsAt: new Date(from), endsAt: new Date(to), kind: "vacation" });

describe("ausência no painel", () => {
  it("vale do início do primeiro dia ao fim do último, no fuso de quem se ausenta", () => {
    expect(absenceRange("2026-11-10", "2026-11-21", "America/Fortaleza")).toEqual({ startsAt: new Date("2026-11-10T03:00:00Z"), endsAt: new Date("2026-11-22T03:00:00Z") });
    expect(absenceRange("2026-11-10", "2026-11-10", "Asia/Tokyo")).toEqual({ startsAt: new Date("2026-11-09T15:00:00Z"), endsAt: new Date("2026-11-10T15:00:00Z") });
    expect(absenceRange("2026-11-21", "2026-11-10", "America/Fortaleza")).toBeNull();
    expect(absenceRange("10/11/2026", "2026-11-21", "America/Fortaleza")).toBeNull();
  });

  it("registra a própria pessoa ou a liderança da equipe; aprova só a liderança, nunca a pessoa ausente", () => {
    const [bruno, carla, , marina] = people as [Person, Person, Person, Person];
    expect(canRegisterAbsence(bruno, bruno)).toBe(true);
    expect(canRegisterAbsence(marina, bruno)).toBe(true);
    expect(canRegisterAbsence(carla, bruno)).toBe(false);
    expect(canApprovePlan(marina, bruno)).toBe(true);
    expect(canApprovePlan(carla, bruno)).toBe(false);
    expect(canApprovePlan(marina, marina)).toBe(false);
    expect(canApprovePlan(person("lider2", { role: "leader", teamId: "vendas" }), bruno, "lider2")).toBe(true);
  });
});

describe("candidatos e plano", () => {
  const tasks = [task("ECH-133", { assigneeId: "bruno", size: 3, area: "pagamentos", dueDate: "2026-11-12" }), task("ECH-137", { assigneeId: "bruno" }), task("ECH-140", { assigneeId: "carla", size: 6 })];
  const prs: PullRequest[] = [{ id: "pr36", repository: "r", number: 36, title: "t", state: "open", branch: "b", files: [], authorId: "yan", reviewerIds: ["bruno", "carla"] }];
  const absences = [vacation("bruno", "2026-11-10T03:00:00Z", "2026-11-22T03:00:00Z"), vacation("yan", "2026-11-11T00:00:00Z", "2026-11-12T00:00:00Z")];
  const input = { absentId: "bruno", people, tasks, pullRequests: prs, absences, linearAccounts: new Set(["carla", "yan", "marina"]), teamLimit: () => 12, now: NOW };

  it("só colegas ativos da equipe, sem RH; carga da calculadora e ausência reduzindo o limite", () => {
    const c = planCandidates(input);
    expect(c.map((x) => x.person.id)).toEqual(["carla", "marina", "yan"]);
    expect(c[0]!.card).toMatchObject({ load: 6.5, limit: 12 });
    expect(c[2]!.card.limit).toBeLessThan(12);
    expect(c.map((x) => x.hasLinearAccount)).toEqual([true, true, true]);
  });

  it("o plano sai igual para os mesmos dados, em qualquer ordem", () => {
    const a = planOptions({ absentId: "bruno", tasks: tasks.filter((t) => t.assigneeId === "bruno"), reviews: prs, candidates: planCandidates(input), now: NOW });
    const b = planOptions({ absentId: "bruno", tasks: tasks.filter((t) => t.assigneeId === "bruno").reverse(), reviews: prs, candidates: planCandidates({ ...input, people: [...people].reverse() }), now: NOW });
    expect(b).toEqual(a);
    expect(a.assignments.map((x) => [x.taskId ?? x.prId, x.toId])).toEqual([["ECH-133", "carla"], ["ECH-137", "marina"], ["pr36", "marina"]]);
  });

  it("ajuste da líder: Linear, ausência até o prazo e autor do PR continuam valendo; limite vira aviso", () => {
    const c = planCandidates(input);
    const [carla, marina, yan] = c;
    expect(adjustmentCheck({ kind: "task", task: tasks[0]! }, yan, NOW)).toEqual({ ok: false, reason: "ausente antes do prazo" });
    expect(adjustmentCheck({ kind: "task", task: tasks[0]! }, { ...carla!, hasLinearAccount: false }, NOW)).toEqual({ ok: false, reason: "sem conta no Linear" });
    expect(adjustmentCheck({ kind: "task", task: { ...tasks[0]!, size: 8 } }, carla, NOW)).toEqual({ ok: true, overLimit: true });
    expect(adjustmentCheck({ kind: "review", pr: prs[0]! }, yan, NOW)).toEqual({ ok: false, reason: "é quem escreveu o PR" });
    expect(adjustmentCheck({ kind: "review", pr: prs[0]! }, marina, NOW)).toEqual({ ok: true, overLimit: false });
    expect(adjustmentCheck({ kind: "task", task: tasks[1]! }, undefined, NOW)).toEqual({ ok: false, reason: "pessoa fora da equipe ou inativa" });
  });
});

describe("complemento e volta", () => {
  it("plano complementar pega só tarefas novas e abertas da pessoa ausente", () => {
    const tasks = [task("A", { assigneeId: "bruno" }), task("B", { assigneeId: "bruno", state: "done" }), task("C", { assigneeId: "bruno" }), task("D", { assigneeId: "carla" })];
    expect(complementTasks("bruno", tasks, new Set(["A"])).map((t) => t.id)).toEqual(["C"]);
  });

  it("na volta, propõe devolver só o que segue aberto com quem recebeu", () => {
    const tasks = [task("A", { assigneeId: "carla" }), task("B", { assigneeId: "carla", state: "done" }), task("C", { assigneeId: "yan" }), task("D", { assigneeId: "marina" })];
    const passed = [
      { itemId: "i1", taskId: "A", holderId: "carla" },
      { itemId: "i2", taskId: "B", holderId: "carla" },
      { itemId: "i3", taskId: "C", holderId: "carla" },
      { itemId: "i4", taskId: "D", holderId: "marina" },
    ];
    expect(returnProposals(passed, tasks, "bruno")).toEqual([
      { itemId: "i1", taskId: "A", fromId: "carla", toId: "bruno", reason: "Voltou da ausência; a tarefa segue aberta com quem a recebeu." },
      { itemId: "i4", taskId: "D", fromId: "marina", toId: "bruno", reason: "Voltou da ausência; a tarefa segue aberta com quem a recebeu." },
    ]);
  });
});
