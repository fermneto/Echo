import type { PersonSchedule, ScheduleEntry } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { MINI_MAX_TASKS, messagesFromRows, parseSeen, tasksFromPlan, tasksFromSchedule, unseenCount } from "./mini";

const entry = (key: string, late = false): ScheduleEntry => ({ key, title: `Tarefa ${key}`, part: "inteira", points: 1, reason: "regra", late, pinned: false });
const schedule = (days: ScheduleEntry[][]): PersonSchedule => ({ days: days.map((entries, i) => ({ date: `2026-11-1${i}`, points: entries.length, entries })), waiting: [], later: [] });

describe("tarefas do Mini Echo", () => {
  it("mostra só o primeiro dia da agenda e marca a atrasada", () => {
    const tasks = tasksFromSchedule(schedule([[entry("ECH-1", true), entry("ECH-2")], [entry("ECH-3")]]));
    expect(tasks).toEqual([
      { key: "ECH-1", ref: "ECH-1", title: "Tarefa ECH-1", late: true },
      { key: "ECH-2", ref: "ECH-2", title: "Tarefa ECH-2", late: false },
    ]);
  });

  it("agenda sem dias vira lista vazia", () => {
    expect(tasksFromSchedule(schedule([]))).toEqual([]);
  });

  it("corta no limite da janelinha", () => {
    const many = Array.from({ length: MINI_MAX_TASKS + 3 }, (_, i) => entry(`ECH-${i}`));
    expect(tasksFromSchedule(schedule([many]))).toHaveLength(MINI_MAX_TASKS);
    expect(tasksFromPlan(many.map((e) => ({ id: e.key, title: e.title, why: "", kind: "prazo" })))).toHaveLength(MINI_MAX_TASKS);
  });
});

describe("mensagens do Mini Echo", () => {
  it("o que ficou para a pessoa decidir vem marcado", () => {
    expect(messagesFromRows([{ key: "q:1", time: "03:15", text: "Eduardo perguntou.", tone: "wait", ref: "ECH-1" }])).toEqual([{ key: "q:1", time: "03:15", text: "Eduardo perguntou.", waiting: true }]);
  });

  it("conta só as que a pessoa ainda não abriu", () => {
    expect(unseenCount([{ key: "a" }, { key: "b" }, { key: "c" }], new Set(["b"]))).toBe(2);
  });

  it("valor corrompido no navegador vale como nada visto", () => {
    expect(parseSeen(null).size).toBe(0);
    expect(parseSeen("{quebrado").size).toBe(0);
    expect(parseSeen('{"a":1}').size).toBe(0);
    expect([...parseSeen('["a",2,"b"]')]).toEqual(["a", "b"]);
  });
});
