// Redistribuição (etapa 11): plano por regra na ausência, nada muda antes da aprovação da liderança, ações no
// outbox com a aprovação registrada, recusa com motivo, plano complementar e devolução na volta.
import type { OutboxAction } from "@echo/actions";
import { type Absence, FixedClock, type Person, type PullRequest, type Task } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import type { AgentData } from "./data.ts";
import { createRedistribution, type ItemState, type PlanState, type RedistributionStore, type StoredAbsence, type StoredRedistribution } from "./redistribution.ts";

const NOW = new Date("2026-11-09T13:00:00Z"); // segunda, 10h em Fortaleza
const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "org", name: `${id[0]!.toUpperCase()}${id.slice(1)} Silva`, role: "member", teamId: "produto", timezone: "America/Fortaleza", workHours: hours, skills: [], areas: [], active: true, ...extra });
const task = (key: string, extra: Partial<Task> = {}): Task => ({ id: key, key, title: key, state: "todo", labels: [], hasLinearId: true, ...extra });

function setup() {
  const clock = new FixedClock(NOW);
  const people = [person("bruno", { areas: ["pagamentos"] }), person("carla", { areas: ["pagamentos"] }), person("yan", { timezone: "Asia/Tokyo" }), person("marina", { role: "leader" }), person("rita", { role: "hr" })];
  const tasks: Task[] = [task("ECH-133", { assigneeId: "bruno", size: 3, area: "pagamentos", dueDate: "2026-11-12" }), task("ECH-137", { assigneeId: "bruno" }), task("ECH-140", { assigneeId: "carla", size: 6 })];
  const prs: PullRequest[] = [{ id: "pr36", repository: "r/app", number: 36, title: "t", state: "open", branch: "b", files: [], authorId: "yan", reviewerIds: ["bruno", "carla"] }];
  const absences: (StoredAbsence & Absence)[] = [
    { id: "a1", personId: "bruno", startsAt: new Date("2026-11-10T03:00:00Z"), endsAt: new Date("2026-11-22T03:00:00Z"), kind: "vacation", cancelled: false },
    { id: "a2", personId: "yan", startsAt: new Date("2026-11-11T00:00:00Z"), endsAt: new Date("2026-11-12T00:00:00Z"), kind: "vacation", cancelled: false },
  ];
  const plans: StoredRedistribution[] = [];
  const local: Record<string, string> = {};
  let seq = 0;
  const store: RedistributionStore = {
    absence: async (id) => absences.find((a) => a.id === id) ?? null,
    createAbsence: async (input) => { const id = `a${absences.length + 1}`; absences.push({ id, ...input, cancelled: false }); return id; },
    recentAbsences: async (now, days) => absences.filter((a) => a.startsAt <= now && a.endsAt.getTime() >= now.getTime() - days * 86_400_000),
    plansForAbsence: async (id) => plans.filter((p) => p.absenceId === id),
    createPlan: async (input) => {
      const plan: StoredRedistribution = { id: `plan${plans.length + 1}`, trigger: input.trigger, ...(input.absenceId ? { absenceId: input.absenceId } : {}), absentId: input.absentId, state: input.items.length ? "awaiting_leader" : "done", items: input.items.map((i) => ({ ...i, id: `i${++seq}` })) };
      plans.push(plan);
      return structuredClone(plan);
    },
    get: async (id) => structuredClone(plans.find((p) => p.id === id) ?? null),
    planOfItem: async (itemId) => structuredClone(plans.find((p) => p.items.some((i) => i.id === itemId)) ?? null),
    inState: async (s) => structuredClone(plans.filter((p) => p.state === s)),
    setPlanState: async (id, from, to, patch) => {
      const p = plans.find((x) => x.id === id);
      if (!p || !from.includes(p.state)) return false;
      p.state = to;
      if (patch?.approvedBy) p.approvedBy = patch.approvedBy;
      return true;
    },
    updateItem: async (itemId, from, patch) => {
      const i = plans.flatMap((p) => p.items).find((x) => x.id === itemId);
      if (!i || !from.includes(i.state)) return false;
      if (patch.toId !== undefined) { if (patch.toId === null) delete i.toId; else i.toId = patch.toId; }
      if (patch.state) i.state = patch.state;
      if (patch.reason) i.reason = patch.reason;
      return true;
    },
    linearAccounts: async () => new Set(["carla", "yan", "marina", "bruno"]),
    teamLeader: async () => "marina",
    assignLocalTask: async (taskId, to) => { local[taskId] = to; },
  };
  const data = {
    people: async () => people,
    tasks: async () => tasks,
    pullRequests: async () => prs,
    absences: async () => absences,
    orgSettings: async () => ({ monthlyLimitUsd: 50, hardLimitUsd: 100, repositoriesOpenToTeam: [], teamLoadLimits: { produto: 12 } }),
  } as unknown as AgentData;
  const outbox: OutboxAction[] = [];
  const recorder = new LogRunRecorder();
  const flow = createRedistribution({
    data: () => data,
    store: () => store,
    outbox: () => ({ enqueue: async (a) => { const dup = outbox.some((x) => x.idempotencyKey === a.idempotencyKey); if (!dup) outbox.push(a); return { id: a.idempotencyKey, duplicate: dup }; } }),
    recorder,
    clock,
    webUrl: "https://echo.test/",
  });
  /** O que o executor (Integrações) faz ao terminar a ação com `planItemId`. */
  const execute = (itemId: string, state: ItemState = "done") => { plans.flatMap((p) => p.items).find((i) => i.id === itemId)!.state = state; };
  const item = (planId: string, label: string) => plans.find((p) => p.id === planId)!.items.find((i) => (i.taskId ?? i.prId) === label)!;
  return { flow, clock, people, tasks, absences, plans, outbox, runs: recorder.runs, local, execute, item, planState: (id: string): PlanState => plans.find((p) => p.id === id)!.state };
}

describe("redistribuição", () => {
  it("empresa sem equipes: a liderança recebe o plano e consegue aprovar; nada vai para quem está ausente", async () => {
    const { flow, people, plans, outbox } = setup();
    for (const p of people) delete (p as { teamId?: string }).teamId;
    const r = await flow.propose("org", "a1");
    expect(r.status).toBe("created");
    expect(outbox.map((a) => a.target)).toEqual(["person:marina"]);
    expect(await flow.approve("org", "carla", plans[0]!.id)).toEqual({ status: "denied" });
    const a = await flow.approve("org", "marina", plans[0]!.id);
    expect(a.status).toBe("ok");
    const assign = outbox.filter((x) => x.type === "linear.assign");
    expect(assign.length).toBeGreaterThan(0);
    expect(assign.every((x) => x.approvedBy === "marina" && (x.payload as { planItemId?: string }).planItemId)).toBe(true);
    // Regra 7: nenhuma mensagem para quem está de férias.
    expect(outbox.some((x) => x.target === "person:bruno")).toBe(false);
  });

  it("ausência → plano por regra, só para a liderança, sem mudar nada", async () => {
    const { flow, outbox, runs, plans } = setup();
    const r = await flow.propose("org", "a1");
    expect(r.status).toBe("created");
    const plan = plans[0]!;
    expect(plan).toMatchObject({ trigger: "vacation", absentId: "bruno", state: "awaiting_leader" });
    expect(plan.items.map((i) => [i.taskId ?? i.prId, i.toId, i.state])).toEqual([["ECH-133", "carla", "proposed"], ["ECH-137", "marina", "proposed"], ["pr36", "marina", "proposed"]]);

    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: "slack.dm", payload: { personId: "marina" }, idempotencyKey: `redistribution_plan:${plan.id}:marina` });
    expect(outbox[0]!.approvedBy).toBeUndefined();
    const text = (outbox[0]!.payload as { text: string }).text;
    expect(text.split("\n")[0]).toBe("*Plano para as férias de Bruno (10 a 21/11)*");
    expect(text).toContain("• ECH-133 → Carla.");
    expect(text).toContain("• Revisão do PR 36 → Marina.");
    expect(text).toContain("Nada muda até você aprovar.");
    expect(text).toContain(`https://echo.test/redistribuicao#plano-${plan.id}`);

    expect(await flow.propose("org", "a1")).toEqual({ status: "skipped", reason: "ausência já tem plano" });
    expect(runs.map((x) => [x.flow, x.result])).toEqual([["redistribution_plan", "ok"], ["redistribution_plan", "skipped"]]);
    expect(runs[0]!.model).toBeUndefined();
  });

  it("aprovação só pela liderança; ajuste com as regras do plano; ações com a aprovação registrada", async () => {
    const { flow, outbox, plans, runs } = setup();
    await flow.propose("org", "a1");
    const plan = plans[0]!;
    const [t133, t137, pr36] = plan.items as [typeof plan.items[0], typeof plan.items[0], typeof plan.items[0]];
    outbox.length = 0;

    expect(await flow.approve("org", "carla", plan.id)).toEqual({ status: "denied" });
    expect(await flow.approve("org", "bruno", plan.id)).toEqual({ status: "denied" });
    expect(await flow.approve("org", "marina", plan.id, { adjust: [{ itemId: pr36.id, toId: "yan" }] })).toEqual({ status: "invalid", reason: "Revisão do PR 36: é quem escreveu o PR" });
    expect(await flow.approve("org", "marina", plan.id, { adjust: [{ itemId: t133.id, toId: "yan" }] })).toEqual({ status: "invalid", reason: "ECH-133: ausente antes do prazo" });
    expect(outbox).toEqual([]);
    expect(plan.state).toBe("awaiting_leader");

    const r = await flow.approve("org", "marina", plan.id, { adjust: [{ itemId: pr36.id, toId: "carla" }], exclude: [t137.id] });
    expect(r.status).toBe("ok");
    expect(plan.state).toBe("executing");
    expect(plan.items.map((i) => [i.taskId ?? i.prId, i.toId, i.state])).toEqual([["ECH-133", "carla", "approved"], ["ECH-137", "marina", "excluded"], ["pr36", "carla", "approved"]]);

    expect(outbox.map((a) => [a.type, a.approvedBy ?? null])).toEqual([
      ["linear.assign", "marina"],
      ["linear.comment", "marina"],
      ["slack.dm", null],
      ["github.set_reviewers", "marina"],
      ["slack.dm", null],
    ]);
    expect(outbox[0]).toMatchObject({ payload: { taskKey: "ECH-133", toPersonId: "carla", planItemId: t133.id }, idempotencyKey: `redistribution:${t133.id}:carla:assign` });
    expect((outbox[1]!.payload as { body: string }).body).toMatch(/^Responsável alterado de Bruno para Carla durante as férias de Bruno \(até 21\/11\), com aprovação de Marina\. Motivo: /);
    expect(outbox[3]).toMatchObject({ payload: { repo: "r/app", number: 36, personIds: ["carla"], planItemId: pr36.id } });
    expect((outbox[2]!.payload as { personId: string; text: string })).toMatchObject({ personId: "carla" });

    expect(await flow.approve("org", "marina", plan.id)).toEqual({ status: "conflict" });
    expect(runs.filter((x) => x.flow === "redistribution_approve").map((x) => x.result)).toEqual(["refused", "refused", "ok"]);
  });

  it("tarefa só do Echo muda aqui mesmo depois da aprovação; rejeitar não muda nada", async () => {
    const s = setup();
    s.tasks[1]!.hasLinearId = false;
    await s.flow.propose("org", "a1");
    await s.flow.approve("org", "marina", "plan1");
    expect(s.local).toEqual({ "ECH-137": "marina" });
    expect(s.item("plan1", "ECH-137").state).toBe("done");
    expect(s.outbox.some((a) => a.type === "linear.assign" && (a.payload as { taskKey: string }).taskKey === "ECH-137")).toBe(false);

    const other = setup();
    await other.flow.propose("org", "a1");
    other.outbox.length = 0;
    expect(await other.flow.reject("org", "carla", "plan1")).toEqual({ status: "denied" });
    expect((await other.flow.reject("org", "marina", "plan1")).status).toBe("ok");
    expect(other.planState("plan1")).toBe("rejected");
    expect(other.outbox).toEqual([]);
    expect(await other.flow.approve("org", "marina", "plan1")).toEqual({ status: "conflict" });
  });

  it("recusa com motivo só por quem recebeu, depois da mudança; a liderança escolhe outra pessoa; resumo no fim", async () => {
    const { flow, outbox, item, execute, planState } = setup();
    await flow.propose("org", "a1");
    await flow.approve("org", "marina", "plan1");
    const t133 = item("plan1", "ECH-133");

    expect(await flow.refuse("org", "carla", t133.id, "Estou na entrega do checkout")).toEqual({ status: "conflict" }); // ainda não mudou
    for (const i of ["ECH-133", "ECH-137", "pr36"]) execute(item("plan1", i).id);
    expect(await flow.refuse("org", "carla", t133.id, "  ")).toEqual({ status: "invalid" });
    expect(await flow.refuse("org", "marina", t133.id, "motivo")).toEqual({ status: "denied" });
    outbox.length = 0;
    expect(await flow.refuse("org", "carla", t133.id, "Estou na entrega do checkout")).toEqual({ status: "refused" });
    expect(item("plan1", "ECH-133").state).toBe("refused");
    expect(outbox).toHaveLength(1);
    const dm = outbox[0]!.payload as { personId: string; text: string };
    expect(dm).toEqual({ personId: "marina", text: "Carla não pode assumir ECH-133. Escolha outra pessoa em Redistribuição." });
    expect(dm.text).not.toContain("checkout");

    expect(await flow.reassign("org", "carla", t133.id, "bruno")).toEqual({ status: "denied" });
    expect(await flow.reassign("org", "marina", t133.id, "yan")).toEqual({ status: "invalid", reason: "ausente antes do prazo" });
    const r = await flow.reassign("org", "marina", t133.id, "marina");
    expect(r.status).toBe("ok");
    expect(item("plan1", "ECH-133")).toMatchObject({ toId: "marina", state: "approved", reason: "Escolhida pela liderança." });
    expect(outbox.find((a) => a.type === "linear.assign")).toMatchObject({ approvedBy: "marina", idempotencyKey: `redistribution:${t133.id}:marina:assign` });

    expect(await flow.sync("org")).toEqual({ done: 0 }); // ainda tem item aprovado
    execute(t133.id);
    expect(await flow.sync("org")).toEqual({ done: 1 });
    expect(planState("plan1")).toBe("done");
    const summary = outbox.at(-1)!;
    expect(summary).toMatchObject({ type: "slack.dm", payload: { personId: "marina" } });
    expect((summary.payload as { text: string }).text).toContain("ECH-133 mudou de responsável no Linear, para Marina.");
    // Regressão: o bloco de contexto vinha da função local context(orgId), que devolvia uma Promise no lugar do bloco.
    const blocks = (summary.payload as { blocks: unknown[] }).blocks;
    expect(blocks.slice(0, 2)).toEqual([
      { type: "header", text: { type: "plain_text", text: "Plano executado" } },
      { type: "context", elements: [{ type: "mrkdwn", text: "Aprovado por Marina" }] },
    ]);
    expect(JSON.stringify(blocks)).toContain("ECH-133 mudou de responsável no Linear, para Marina.");
    expect(await flow.sync("org")).toEqual({ done: 0 });
  });

  it("durante a ausência, tarefa nova vira plano complementar; na volta, resumo e plano de devolução", async () => {
    const { flow, clock, tasks, outbox, plans, item, execute, runs } = setup();
    await flow.propose("org", "a1");
    expect(await flow.scan("org")).toEqual({ complements: 0, returns: 0 }); // plano ainda sem decisão
    await flow.approve("org", "marina", "plan1");
    for (const i of ["ECH-133", "ECH-137", "pr36"]) execute(item("plan1", i).id);
    tasks[0]!.assigneeId = "carla"; // a sincronização do Linear traz a mudança
    tasks[1]!.assigneeId = "marina";

    clock.set("2026-11-12T13:00:00Z");
    tasks.push(task("ECH-150", { assigneeId: "bruno" }));
    expect(await flow.scan("org")).toEqual({ complements: 1, returns: 0 });
    expect(plans[1]).toMatchObject({ trigger: "complement", absenceId: "a1", state: "awaiting_leader" });
    expect(plans[1]!.items.map((i) => i.taskId)).toEqual(["ECH-150"]);
    expect((outbox.at(-1)!.payload as { text: string }).text.split("\n")[0]).toBe("*Plano complementar para as férias de Bruno (10 a 21/11)*");
    expect(await flow.scan("org")).toEqual({ complements: 0, returns: 0 }); // um complementar por vez

    clock.set("2026-11-23T13:00:00Z"); // segunda, de volta ao expediente
    tasks[1]!.state = "done";
    outbox.length = 0;
    expect(await flow.scan("org")).toEqual({ complements: 0, returns: 1 });
    expect(outbox[0]).toMatchObject({ type: "slack.dm", payload: { personId: "bruno" }, idempotencyKey: "redistribution_return:a1" });
    expect((outbox[0]!.payload as { text: string }).text).toContain("ECH-133 ficou com Carla");
    const back = plans.find((p) => p.trigger === "return")!;
    expect(back.items.map((i) => [i.taskId, i.fromId, i.toId])).toEqual([["ECH-133", "carla", "bruno"]]); // ECH-137 já foi concluída
    expect((outbox[1]!.payload as { text: string; personId: string })).toMatchObject({ personId: "marina" });
    expect(await flow.scan("org")).toEqual({ complements: 0, returns: 0 });

    await flow.approve("org", "marina", back.id);
    const dm = outbox.find((a) => a.type === "slack.dm" && (a.payload as { personId: string }).personId === "bruno" && a.idempotencyKey.startsWith("redistribution:"))!;
    expect((dm.payload as { text: string }).text).toBe("ECH-133 voltou para você, com aprovação de Marina.");
    expect(runs.some((x) => x.flow === "redistribution_return")).toBe(true);
  });

  it("ausência pelo painel: a própria pessoa ou a liderança, no fuso de quem se ausenta", async () => {
    const { flow, absences } = setup();
    expect(await flow.registerAbsence("org", "carla", { personId: "bruno", startDate: "2026-12-01", endDate: "2026-12-05", kind: "vacation" })).toEqual({ status: "denied" });
    expect(await flow.registerAbsence("org", "yan", { personId: "yan", startDate: "2026-12-05", endDate: "2026-12-01", kind: "vacation" })).toEqual({ status: "invalid" });
    const r = await flow.registerAbsence("org", "marina", { personId: "yan", startDate: "2026-12-01", endDate: "2026-12-01", kind: "leave" });
    expect(r.status).toBe("registered");
    expect(absences.at(-1)).toMatchObject({ personId: "yan", startsAt: new Date("2026-11-30T15:00:00Z"), endsAt: new Date("2026-12-01T15:00:00Z"), kind: "leave" });
  });
});
