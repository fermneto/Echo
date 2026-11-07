import { describe, expect, it } from "vitest";
import {
  branchStatus,
  capacityCard,
  contributionScore,
  costLevel,
  isAway,
  peopleForTopic,
  planOptions,
  planReviewers,
  type CapacityCard,
  type PlanInput,
  type TopicEvidence,
  weeklyMetrics,
} from "./rules.ts";
import { DAY, HOUR } from "./time.ts";
import type { Absence, Contribution, DailyNote, Person, PullRequest, Task, WorkEvent } from "./types.ts";

const weekdays = (start = "09:00", end = "18:00") => ({ days: [1, 2, 3, 4, 5], start, end });
const person = (id: string, timezone: string, extra: Partial<Person> = {}): Person => ({
  id, orgId: "org", name: id[0]!.toUpperCase() + id.slice(1), role: "member", timezone, workHours: weekdays(), skills: [], areas: [], active: true, ...extra,
});
const fernando = person("fernando", "America/Fortaleza", { areas: ["pagamentos", "api"] });
const eduardo = person("eduardo", "Africa/Johannesburg", { areas: ["api", "web"], workHours: weekdays("08:00", "17:00") });
const yan = person("yan", "Asia/Tokyo", { areas: ["web"] });
const bruno = person("bruno", "America/Sao_Paulo", { areas: ["pagamentos", "infra"] });
const carla = person("carla", "America/Sao_Paulo", { areas: ["pagamentos"], skills: ["middlewares"] });

const scene = new Date("2026-11-06T06:12:00Z"); // sexta: 03:12 Fortaleza, 08:12 Joanesburgo, 15:12 Tóquio
const vacation = (personId: string, start: string, end: string): Absence => ({ personId, startsAt: new Date(start), endsAt: new Date(end), kind: "vacation" });

describe("isAway", () => {
  it("cena 1: Fernando dorme em Fortaleza e volta às 9h locais; Eduardo e Yan estão no expediente", () => {
    expect(isAway(fernando, [], scene)).toEqual({ away: true, reason: "off_hours", returnsAt: new Date("2026-11-06T12:00:00Z") });
    expect(isAway(eduardo, [], scene)).toEqual({ away: false });
    expect(isAway(yan, [], scene)).toEqual({ away: false });
  });

  it("depois do expediente, a volta é no dia seguinte; na sexta, só na segunda", () => {
    const fridayNight = new Date("2026-11-06T23:00:00Z"); // 20:00 em Fortaleza
    expect(isAway(fernando, [], fridayNight).returnsAt).toEqual(new Date("2026-11-09T12:00:00Z"));
    const thursdayNight = new Date("2026-11-05T23:00:00Z");
    expect(isAway(fernando, [], thursdayNight).returnsAt).toEqual(new Date("2026-11-06T12:00:00Z"));
  });

  it("no sábado local, mesmo com UTC ainda na sexta, é fim de semana (virada do dia em Tóquio)", () => {
    const fridayUtc = new Date("2026-11-06T16:00:00Z"); // sábado 01:00 em Tóquio
    expect(isAway(yan, [], fridayUtc)).toMatchObject({ away: true, reason: "weekend", returnsAt: new Date("2026-11-09T00:00:00Z") });
  });

  it("de férias, volta no primeiro expediente depois do fim da ausência", () => {
    const abs = [vacation("bruno", "2026-11-10T03:00:00Z", "2026-11-21T03:00:00Z")]; // 10 a 20/11 em São Paulo
    const during = new Date("2026-11-12T15:00:00Z");
    expect(isAway(bruno, abs, during)).toEqual({ away: true, reason: "absence", returnsAt: new Date("2026-11-23T12:00:00Z") });
  });

  it("ausência que termina no meio do expediente: volta no fim dela", () => {
    const abs = [{ personId: "carla", startsAt: new Date("2026-11-06T12:00:00Z"), endsAt: new Date("2026-11-06T17:00:00Z"), kind: "ooo" as const }];
    expect(isAway(carla, abs, new Date("2026-11-06T13:00:00Z")).returnsAt).toEqual(new Date("2026-11-06T17:00:00Z"));
  });

  it("ignora a ausência de outra pessoa", () => {
    const abs = [vacation("bruno", "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z")];
    expect(isAway(carla, abs, new Date("2026-11-06T15:00:00Z"))).toEqual({ away: false });
  });

  it("usa o horário de verão do fuso da pessoa", () => {
    const berlin = person("hans", "Europe/Berlin");
    // Segunda 30/03, 07:30 UTC = 09:30 em Berlim (verão): já no expediente.
    expect(isAway(berlin, [], new Date("2026-03-30T07:30:00Z"))).toEqual({ away: false });
    // Sexta 27/03, 07:30 UTC = 08:30 em Berlim (inverno): ainda não começou.
    expect(isAway(berlin, [], new Date("2026-03-27T07:30:00Z")).returnsAt).toEqual(new Date("2026-03-27T08:00:00Z"));
  });
});

describe("branchStatus", () => {
  const note = (extra: Partial<DailyNote> = {}): DailyNote => ({
    personId: "fernando", date: "2026-11-05", state: "confirmed", confirmedAt: new Date("2026-11-05T21:00:00Z"),
    released: [{ branch: "ech-131-api-v2", to: "eduardo", reason: "API fechada" }],
    reserved: [{ branch: "ech-128-tempo-limite", reason: "até a revisão" }],
    ...extra,
  });
  const pr = (extra: Partial<PullRequest> = {}): PullRequest => ({ id: "p", repository: "r", number: 44, title: "t", state: "open", branch: "ech-128-tempo-limite", files: [], reviewerIds: [], ...extra });

  it("cena 1: libera ech-131-api-v2 pela nota confirmada", () => {
    const r = branchStatus({ branch: "ech-131-api-v2", note: note(), now: scene });
    expect(r.status).toBe("released");
    expect(r.mark?.to).toBe("eduardo");
    expect(r.sources[0]?.label).toContain("confirmada");
  });

  it("cena 1: ech-128-tempo-limite está reservada, com o PR como fonte", () => {
    const r = branchStatus({ branch: "ech-128-tempo-limite", note: note(), pr: pr(), now: scene });
    expect(r.status).toBe("reserved");
    expect(r.sources.map((s) => s.ref)).toEqual(["daily_note:fernando:2026-11-05", "github:pr/44"]);
  });

  it("reserva vence liberação na mesma branch", () => {
    const both = note({ released: [{ branch: "x" }], reserved: [{ branch: "x" }] });
    expect(branchStatus({ branch: "x", note: both, now: scene }).status).toBe("reserved");
  });

  it("liberação vale 7 dias, ou até 'until' se vier antes", () => {
    expect(branchStatus({ branch: "ech-131-api-v2", note: note(), now: new Date("2026-11-12T20:59:00Z") }).status).toBe("released");
    expect(branchStatus({ branch: "ech-131-api-v2", note: note(), now: new Date("2026-11-12T21:01:00Z") }).status).toBe("unknown");
    const short = note({ released: [{ branch: "ech-131-api-v2", until: "2026-11-06" }] });
    expect(branchStatus({ branch: "ech-131-api-v2", note: short, now: new Date("2026-11-07T01:00:00Z") }).status).toBe("unknown");
  });

  it("nota publicada sem conferência mantém reservas e não libera", () => {
    const auto = note({ state: "auto_unreviewed", confirmedAt: undefined });
    expect(branchStatus({ branch: "ech-131-api-v2", note: auto, now: scene }).status).toBe("unknown");
    expect(branchStatus({ branch: "ech-128-tempo-limite", note: auto, now: scene }).status).toBe("reserved");
  });

  it("rascunho não vale nada", () => {
    expect(branchStatus({ branch: "ech-131-api-v2", note: note({ state: "draft" }), now: scene }).status).toBe("unknown");
  });

  it("sem marcação: PR aberto ou commit recente é em andamento; parado é sem atividade; sem nada, desconhecido", () => {
    expect(branchStatus({ branch: "b", pr: pr({ branch: "b" }), now: scene }).status).toBe("in_progress");
    expect(branchStatus({ branch: "b", lastCommitAt: new Date(scene.getTime() - 2 * DAY), now: scene }).status).toBe("in_progress");
    expect(branchStatus({ branch: "b", pr: pr({ state: "merged" }), lastCommitAt: new Date(scene.getTime() - 30 * DAY), now: scene }).status).toBe("no_activity");
    expect(branchStatus({ branch: "b", now: scene })).toEqual({ status: "unknown", sources: [] });
  });
});

const task = (key: string, extra: Partial<Task> = {}): Task => ({ id: key, key, title: key, state: "todo", labels: [], hasLinearId: true, ...extra });

describe("capacityCard", () => {
  const base = { pendingReviews: 0, absences: [] as Absence[], adjustment: 0, teamLimit: 12, now: scene };

  it("soma tamanhos (sem tamanho vale 2), revisões × 0,5, prazos próximos e ajustes", () => {
    const tasks = [task("A", { size: 3 }), task("B"), task("C", { size: 5, dueDate: "2026-11-08" }), task("D", { size: 1, state: "done" })];
    const card = capacityCard({ ...base, person: bruno, openTasks: tasks, pendingReviews: 3, adjustment: 1 });
    // 3 + 2 + 5 + 1,5 + 1 (prazo em 2 dias) + 1 (ajuste) = 13,5
    expect(card).toEqual({ personId: "bruno", load: 13.5, limit: 12, slack: -1.5, areas: ["pagamentos", "infra"], overLimit: true });
  });

  it("prazo em até 3 dias segue a data local da pessoa", () => {
    // 03:12 de sexta em Fortaleza: até segunda (09/11) conta; terça (10/11) não.
    const card = capacityCard({ ...base, person: fernando, openTasks: [task("A", { size: 1, dueDate: "2026-11-09" }), task("B", { size: 1, dueDate: "2026-11-10" })] });
    expect(card.load).toBe(3);
  });

  it("prazo vencido também pesa", () => {
    expect(capacityCard({ ...base, person: carla, openTasks: [task("A", { size: 1, dueDate: "2026-11-01" })] }).load).toBe(2);
  });

  it("ausência reduz o limite, não a carga", () => {
    const abs = [vacation("bruno", scene.toISOString(), new Date(scene.getTime() + 3.5 * DAY).toISOString())];
    const card = capacityCard({ ...base, person: bruno, openTasks: [task("A", { size: 4 })], absences: abs });
    expect(card.load).toBe(4);
    expect(card.limit).toBe(6);
  });
});

describe("planOptions e planReviewers (férias de Bruno)", () => {
  const card = (personId: string, load: number, limit = 12): CapacityCard => ({ personId, load, limit, slack: limit - load, areas: [], overLimit: load > limit });
  const candidates = (overrides: Partial<Record<string, Partial<PlanInput["candidates"][number]>>> = {}): PlanInput["candidates"] =>
    [
      { person: fernando, card: card("fernando", 10.7), absences: [], hasLinearAccount: true },
      { person: carla, card: card("carla", 4), absences: [], hasLinearAccount: true },
      { person: yan, card: card("yan", 2), absences: [], hasLinearAccount: true },
      { person: eduardo, card: card("eduardo", 5), absences: [], hasLinearAccount: true },
      { person: bruno, card: card("bruno", 14.5), absences: [], hasLinearAccount: true },
    ].map((c) => ({ ...c, ...overrides[c.person.id] }));
  const tasks = [task("ECH-133", { size: 3, area: "pagamentos", dueDate: "2026-11-12" }), task("ECH-137", { size: 2 })];
  const reviews: PullRequest[] = [{ id: "pr36", repository: "r", number: 36, title: "t", state: "open", branch: "b", files: [], authorId: "yan", reviewerIds: ["bruno"] }];
  const input = (extra: Partial<PlanInput> = {}): PlanInput => ({ absentId: "bruno", tasks, reviews, candidates: candidates(), now: scene, ...extra });

  it("passa a tarefa de pagamentos para quem atua na área e tem folga, e a sem área para quem tem mais folga", () => {
    const { assignments, unassigned } = planOptions(input());
    expect(unassigned).toEqual([]);
    expect(assignments).toEqual([
      { taskId: "ECH-133", fromId: "bruno", toId: "carla", reason: "Atua em pagamentos e tem folga." },
      { taskId: "ECH-137", fromId: "bruno", toId: "yan", reason: "Sem área definida, escolhida pela folga." },
      { prId: "pr36", fromId: "bruno", toId: "eduardo", reason: "Revisão para quem tem mais folga." },
    ]);
  });

  it("nunca dá a revisão ao autor do PR, nem a quem tem ausência nos próximos 14 dias", () => {
    const away = { eduardo: { absences: [vacation("eduardo", "2026-11-15T00:00:00Z", "2026-11-18T00:00:00Z")] } };
    const out = planReviewers(input({ candidates: candidates(away) }));
    expect(out).toEqual([{ prId: "pr36", fromId: "bruno", toId: "carla", reason: "Revisão para quem tem mais folga." }]);
  });

  it("não passa tarefa para quem estará ausente antes do prazo", () => {
    const away = { carla: { absences: [vacation("carla", "2026-11-10T00:00:00Z", "2026-11-14T00:00:00Z")] } };
    const first = planOptions(input({ candidates: candidates(away) })).assignments[0];
    expect(first).toMatchObject({ taskId: "ECH-133", toId: "yan", reason: "Ninguém de pagamentos tem folga; escolhida pela folga." });
  });

  it("tarefa do Linear só vai para quem tem conta lá; sem ninguém, fica sem responsável com o motivo", () => {
    const noLinear = Object.fromEntries(["fernando", "carla", "yan", "eduardo"].map((id) => [id, { hasLinearAccount: false }]));
    const { assignments, unassigned } = planOptions(input({ reviews: [], candidates: candidates(noLinear) }));
    expect(assignments).toEqual([]);
    const reason = "Ninguém com folga tem conta no Linear: fica sem responsável.";
    expect(unassigned.map((u) => [u.taskId, u.reason])).toEqual([["ECH-133", reason], ["ECH-137", reason]]);
  });

  it("sem folga para ninguém: adiar, reduzir ou chamar outra equipe", () => {
    const full = Object.fromEntries(["fernando", "carla", "yan", "eduardo"].map((id) => [id, { card: card(id, 11.9) }]));
    const { unassigned } = planOptions(input({ reviews: [], candidates: candidates(full) }));
    expect(unassigned[0]?.reason).toBe("Ninguém tem folga até o prazo: adiar, reduzir ou chamar outra equipe.");
  });

  it("deriva a área das etiquetas quando a tarefa não tem área", () => {
    const labeled = [task("ECH-150", { size: 2, labels: ["marketing", "web"] })];
    const first = planOptions(input({ tasks: labeled, reviews: [] })).assignments[0];
    expect(first).toMatchObject({ toId: "yan", reason: "Atua em web e tem folga." });
  });

  it("dá sempre o mesmo resultado para os mesmos dados, em qualquer ordem de entrada", () => {
    const a = planOptions(input());
    const b = planOptions(input({ tasks: [...tasks].reverse(), candidates: candidates().reverse() }));
    expect(b).toEqual(a);
  });
});

describe("weeklyMetrics (Carla)", () => {
  const from = new Date("2026-11-02T00:00:00Z");
  const to = new Date("2026-11-09T00:00:00Z");
  const ev = (type: WorkEvent["type"], at: string, extra: Partial<WorkEvent> = {}): WorkEvent => ({ type, personId: "carla", occurredAt: new Date(at), source: "github", sourceRef: `${type}:${at}`, ...extra });
  const help = (at: string, confirmed = true): Contribution => ({ helperId: "carla", helpedId: "bruno", kind: "reaction", confirmed, occurredAt: new Date(at) });

  it("conta poucos commits, nenhuma entrega e as 5 ajudas confirmadas", () => {
    const events = [ev("commit", "2026-11-03T12:00:00Z"), ev("commit", "2026-11-04T12:00:00Z"), ev("review", "2026-11-05T12:00:00Z"), ev("review_comment", "2026-11-05T13:00:00Z")];
    const contributions = [1, 2, 3, 4, 5].map((d) => help(`2026-11-0${d + 2}T12:00:00Z`)).concat([help("2026-11-04T12:00:00Z", false), help("2026-10-20T12:00:00Z")]);
    expect(weeklyMetrics({ personId: "carla", events, contributions, tasks: [], from, to })).toEqual({ deliveries: 0, commits: 2, reviews: 1, helps: 5, delays: [] });
  });

  it("PR ligado e conclusão da tarefa são uma entrega só", () => {
    const events = [ev("pr_merged", "2026-11-04T12:00:00Z", { taskKey: "ECH-135", prNumber: 34 }), ev("task_done", "2026-11-04T12:05:00Z", { taskKey: "ECH-135" }), ev("pr_merged", "2026-11-05T12:00:00Z", { prNumber: 40 })];
    expect(weeklyMetrics({ personId: "carla", events, contributions: [], tasks: [], from, to }).deliveries).toBe(2);
  });

  it("aponta atrasos: concluída depois do prazo ou ainda aberta com o prazo vencido", () => {
    const tasks = [
      task("ECH-1", { assigneeId: "carla", dueDate: "2026-11-03", state: "done" }),
      task("ECH-2", { assigneeId: "carla", dueDate: "2026-11-04", state: "in_progress" }),
      task("ECH-3", { assigneeId: "carla", dueDate: "2026-11-05", state: "done" }),
      task("ECH-4", { assigneeId: "bruno", dueDate: "2026-11-04", state: "todo" }),
    ];
    const events = [ev("task_done", "2026-11-04T10:00:00Z", { taskKey: "ECH-1" }), ev("task_done", "2026-11-05T10:00:00Z", { taskKey: "ECH-3" })];
    expect(weeklyMetrics({ personId: "carla", events, contributions: [], tasks, from, to }).delays).toEqual([{ taskKey: "ECH-1" }, { taskKey: "ECH-2" }]);
  });
});

describe("contributionScore", () => {
  it("coautoria, mudança em revisão e destravamento são fortes; reação e confirmação, médias", () => {
    const c = (kind: Contribution["kind"]) => contributionScore({ helperId: "a", helpedId: "b", kind, confirmed: true, occurredAt: scene }).weight;
    expect(["coauthor", "review_change", "unblock", "reaction", "panel_confirm"].map((k) => c(k as Contribution["kind"]))).toEqual(["forte", "forte", "forte", "medio", "medio"]);
  });
});

describe("peopleForTopic", () => {
  const ago = (days: number) => new Date(scene.getTime() - days * DAY);
  const e = (personId: string, kind: TopicEvidence["kind"], days: number, ref: string): TopicEvidence => ({ personId, kind, at: ago(days), source: { label: ref, ref } });
  const people = [fernando, carla, bruno, yan, eduardo, person("ex", "UTC", { active: false })];

  it("pontua por peso e recência e devolve até 3 pessoas com a evidência", () => {
    const evidence = [
      e("carla", "pr_merged", 20, "github:pr/31"), // 3
      e("carla", "help", 200, "slack:1"), // 1,5
      e("bruno", "review", 20, "github:pr/31"), // 2
      e("fernando", "task_done", 10, "linear:ECH-1"), // 1
      e("yan", "profile", 5, "perfil:yan"), // 1
      e("eduardo", "pr_merged", 400, "github:pr/2"), // 0: velho demais
      e("ex", "pr_merged", 1, "github:pr/9"), // inativo
    ];
    const out = peopleForTopic({ evidence, people, status: { bruno: "over_limit" }, excluded: [], now: scene });
    expect(out.map((c) => [c.personId, c.score, c.status])).toEqual([["carla", 4.5, "available"], ["bruno", 2, "over_limit"], ["fernando", 1, "available"]]);
    expect(out[0]?.evidence.map((s) => s.ref)).toEqual(["github:pr/31", "slack:1"]);
  });

  it("deixa de fora quem foi excluído (quem perguntou, por exemplo)", () => {
    const out = peopleForTopic({ evidence: [e("carla", "help", 1, "x"), e("bruno", "help", 1, "y")], people, status: {}, excluded: ["carla"], now: scene });
    expect(out.map((c) => c.personId)).toEqual(["bruno"]);
  });
});

describe("costLevel", () => {
  it("80% para correções, 100% só regras, 200% sem IA", () => {
    expect([0, 39.99, 40, 50, 99.99, 100].map((s) => costLevel(s, 50))).toEqual(["normal", "normal", "stop_fixes", "rules_only", "rules_only", "hard_limit"]);
  });

  it("sem limite configurado não gasta com IA", () => {
    expect(costLevel(0, 0)).toBe("rules_only");
    expect(costLevel(1, 0)).toBe("hard_limit");
  });
});

it("nenhuma regra lê a hora do sistema", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./rules.ts", import.meta.url), "utf8") + readFileSync(new URL("./time.ts", import.meta.url), "utf8");
  expect(src).not.toMatch(/Date\.now\(|new Date\(\)/);
  expect(HOUR).toBe(3_600_000);
});
