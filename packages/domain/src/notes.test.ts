import { describe, expect, it } from "vitest";
import { canConfirmNote, carriedMarks, endOfDayDue, hasRecentActivity, noteBlockers, noteStateAt } from "./notes.ts";
import { branchStatus } from "./rules.ts";
import { DAY, HOUR, MINUTE } from "./time.ts";
import type { DailyNote, Person, PullRequest, Task, WorkEvent } from "./types.ts";

const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, timezone: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "o", name: id, role: "member", timezone, workHours: hours, skills: [], areas: [], active: true, ...extra });
const fernando = person("fernando", "America/Fortaleza"); // UTC-3
const eduardo = person("eduardo", "Africa/Johannesburg", { workHours: { ...hours, start: "08:00", end: "17:00" } }); // UTC+2
const kenji = person("kenji", "Asia/Tokyo"); // UTC+9

describe("endOfDayDue", () => {
  // Sexta, 06/11/2026.
  it("no fim do expediente local, com a data local como chave", () => {
    expect(endOfDayDue(fernando, [], new Date("2026-11-06T21:05:00Z"))).toEqual({ date: "2026-11-06", endsAt: new Date("2026-11-06T21:00:00Z") });
    expect(endOfDayDue(eduardo, [], new Date("2026-11-06T15:00:00Z"))?.date).toBe("2026-11-06");
    // Tóquio: 18h de sexta é 09h UTC de sexta.
    expect(endOfDayDue(kenji, [], new Date("2026-11-06T09:30:00Z"))?.date).toBe("2026-11-06");
  });

  it("antes do fim, depois da janela de 3 h ou no fim de semana: nada", () => {
    expect(endOfDayDue(fernando, [], new Date("2026-11-06T20:59:00Z"))).toBeNull();
    expect(endOfDayDue(fernando, [], new Date("2026-11-07T00:00:00Z"))).toBeNull();
    expect(endOfDayDue(fernando, [], new Date("2026-11-07T21:05:00Z"))).toBeNull(); // sábado
  });

  it("virada de dia em UTC: Fortaleza com expediente até 23h ainda é sexta", () => {
    const late = person("late", "America/Fortaleza", { workHours: { ...hours, end: "23:00" } });
    expect(endOfDayDue(late, [], new Date("2026-11-07T02:30:00Z"))?.date).toBe("2026-11-06");
  });

  it("férias no fim do expediente, RH e pessoa inativa: sem rascunho", () => {
    const vacation = [{ personId: "fernando", startsAt: new Date("2026-11-02T00:00:00Z"), endsAt: new Date("2026-11-10T00:00:00Z"), kind: "vacation" as const }];
    expect(endOfDayDue(fernando, vacation, new Date("2026-11-06T21:05:00Z"))).toBeNull();
    expect(endOfDayDue({ ...fernando, role: "hr" }, [], new Date("2026-11-06T21:05:00Z"))).toBeNull();
    expect(endOfDayDue({ ...fernando, active: false }, [], new Date("2026-11-06T21:05:00Z"))).toBeNull();
  });
});

describe("hasRecentActivity", () => {
  const now = new Date("2026-11-06T21:05:00Z");
  const ev = (at: Date, personId = "fernando"): WorkEvent => ({ type: "commit", personId, occurredAt: at, source: "github", sourceRef: String(at.getTime()) });
  it("só eventos da pessoa nas últimas 24 h", () => {
    expect(hasRecentActivity([ev(new Date(now.getTime() - 2 * HOUR))], "fernando", now)).toBe(true);
    expect(hasRecentActivity([ev(new Date(now.getTime() - 25 * HOUR))], "fernando", now)).toBe(false);
    expect(hasRecentActivity([ev(new Date(now.getTime() - HOUR), "carla")], "fernando", now)).toBe(false);
  });
});

describe("noteBlockers", () => {
  const now = new Date("2026-11-06T21:05:00Z");
  const pr = (number: number, extra: Partial<PullRequest> = {}): PullRequest => ({ id: `pr${number}`, repository: "r/app", number, title: "t", authorId: "fernando", state: "open", branch: `b${number}`, files: [], reviewerIds: [], openedAt: new Date(now.getTime() - 2 * DAY), ...extra });
  const task = (key: string, extra: Partial<Task> = {}): Task => ({ id: key, key, title: key, assigneeId: "fernando", state: "in_progress", labels: [], hasLinearId: true, ...extra });

  it("PR parado sem revisão, tarefa vencida no fuso da pessoa e etiqueta de bloqueio", () => {
    const blockers = noteBlockers({
      person: fernando,
      pullRequests: [pr(44), pr(45, { openedAt: new Date(now.getTime() - 3 * HOUR) }), pr(46, { reviewerIds: ["carla"] }), pr(47, { authorId: "carla" })],
      tasks: [task("ECH-128", { dueDate: "2026-11-05" }), task("ECH-129", { dueDate: "2026-11-06" }), task("ECH-130", { labels: ["Bloqueado"] }), task("ECH-131", { dueDate: "2026-11-01", state: "done" })],
      events: [{ type: "review", personId: "carla", repository: "r/app", prNumber: 46, occurredAt: new Date(now.getTime() - HOUR), source: "github", sourceRef: "rv" }],
      now,
    });
    expect(blockers.map((b) => (b.kind === "pr_waiting_review" ? `pr:${b.pr.number}` : `${b.kind}:${b.task.key}`))).toEqual(["pr:44", "task_overdue:ECH-128", "task_blocked_label:ECH-130"]);
  });
});

describe("carriedMarks e validade", () => {
  const confirmedAt = new Date("2026-11-02T21:00:00Z");
  const previous: DailyNote = {
    personId: "fernando",
    date: "2026-11-02",
    released: [{ branch: "ech-131-api-v2", to: "eduardo" }],
    reserved: [{ branch: "ech-128-tempo-limite", reason: "Até a revisão sair." }],
    state: "confirmed",
    confirmedAt,
  };

  it("reservas seguem; liberação válida segue com a data da confirmação original", () => {
    const marks = carriedMarks(previous, new Date("2026-11-06T21:00:00Z"));
    expect(marks.reserved).toEqual(previous.reserved);
    expect(marks.released).toEqual([{ branch: "ech-131-api-v2", to: "eduardo", confirmedAt: confirmedAt.toISOString() }]);
  });

  it("liberação vence em 7 dias, mesmo trazida para uma nota nova confirmada depois", () => {
    expect(carriedMarks(previous, new Date(confirmedAt.getTime() + 7 * DAY)).released).toEqual([]);
    const carried = carriedMarks(previous, new Date("2026-11-06T21:00:00Z"));
    const next: DailyNote = { personId: "fernando", date: "2026-11-06", ...carried, state: "confirmed", confirmedAt: new Date("2026-11-06T22:00:00Z") };
    expect(branchStatus({ branch: "ech-131-api-v2", note: next, now: new Date(confirmedAt.getTime() + 6 * DAY) }).status).toBe("released");
    expect(branchStatus({ branch: "ech-131-api-v2", note: next, now: new Date(confirmedAt.getTime() + 7 * DAY + MINUTE) }).status).toBe("unknown");
  });

  it("nota automática: mantém reservas, não libera nada novo, mas guarda o que já vinha confirmado", () => {
    const now = new Date("2026-11-06T21:00:00Z");
    const auto: DailyNote = {
      personId: "fernando",
      date: "2026-11-06",
      released: [...carriedMarks(previous, now).released, { branch: "ech-140-nova", to: "eduardo" }],
      reserved: previous.reserved,
      state: "auto_unreviewed",
    };
    expect(branchStatus({ branch: "ech-128-tempo-limite", note: auto, now }).status).toBe("reserved");
    expect(branchStatus({ branch: "ech-131-api-v2", note: auto, now }).status).toBe("released");
    expect(branchStatus({ branch: "ech-140-nova", note: auto, now }).status).toBe("unknown");
    // E a nota automática não passa liberação sem confirmação para a seguinte.
    expect(carriedMarks(auto, now).released.map((m) => m.branch)).toEqual(["ech-131-api-v2"]);
  });

  it("rascunho anterior não conta", () => {
    expect(carriedMarks({ ...previous, state: "draft" }, new Date("2026-11-06T21:00:00Z"))).toEqual({ released: [], reserved: [] });
  });
});

describe("estados da nota", () => {
  const createdAt = new Date("2026-11-06T21:00:00Z");
  it("draft vira auto_unreviewed em 2 h; confirmada não muda", () => {
    expect(noteStateAt({ state: "draft", createdAt }, new Date(createdAt.getTime() + 2 * HOUR - 1))).toBe("draft");
    expect(noteStateAt({ state: "draft", createdAt }, new Date(createdAt.getTime() + 2 * HOUR))).toBe("auto_unreviewed");
    expect(noteStateAt({ state: "confirmed", createdAt }, new Date(createdAt.getTime() + 5 * HOUR))).toBe("confirmed");
  });

  it("só a dona confirma, e só o que ainda não está confirmado", () => {
    expect(canConfirmNote({ personId: "fernando", state: "draft" }, "fernando")).toBe(true);
    expect(canConfirmNote({ personId: "fernando", state: "auto_unreviewed" }, "fernando")).toBe(true);
    expect(canConfirmNote({ personId: "fernando", state: "draft" }, "eduardo")).toBe(false);
    expect(canConfirmNote({ personId: "fernando", state: "confirmed" }, "fernando")).toBe(false);
  });
});
