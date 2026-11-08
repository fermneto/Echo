// Redistribuição (etapa 11, F6). Sem modelo: a carga, o plano e os motivos saem das regras fixas.
// Nada muda antes da aprovação da liderança. Depois dela, cada mudança vira uma ação no outbox com chave única
// e aprovação registrada; só packages/actions altera Linear, GitHub e Slack, e marca o item do plano.
import type { OutboxAction } from "@echo/actions";
import {
  type AbsenceKind,
  absenceRange,
  adjustmentCheck,
  canApprovePlan,
  canRegisterAbsence,
  type Clock,
  complementTasks,
  isAway,
  localDate,
  type Person,
  type PlanAssignment,
  planCandidates,
  planOptions,
  type PullRequest,
  returnProposals,
  systemClock,
  type Task,
} from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import type { AgentData } from "./data.ts";
import { actions, context as contextBlock, dayMonth, DOT, esc, header, linkButton, section, sectionsOf, statusTag } from "./slack-format.ts";

// ---------- Portas

export type PlanTrigger = "vacation" | "unexpected" | "leader_request" | "complement" | "return";
export type PlanState = "awaiting_leader" | "executing" | "done" | "rejected";
/** `done` e `failed` são marcados pelo executor do outbox (pelo `planItemId`). */
export type ItemState = "proposed" | "unassigned" | "approved" | "done" | "failed" | "refused" | "excluded";

export interface StoredAbsence {
  id: string;
  personId: string;
  startsAt: Date;
  endsAt: Date;
  kind: AbsenceKind;
  cancelled: boolean;
}

export interface StoredPlanItem {
  id: string;
  taskId?: string;
  prId?: string;
  fromId: string;
  toId?: string;
  reason: string;
  state: ItemState;
}

export interface StoredRedistribution {
  id: string;
  trigger: PlanTrigger;
  absenceId?: string;
  absentId: string;
  state: PlanState;
  approvedBy?: string;
  items: StoredPlanItem[];
}

export interface NewPlanItem {
  taskId?: string;
  prId?: string;
  fromId: string;
  toId?: string;
  reason: string;
  state: "proposed" | "unassigned";
}

/** Tabelas `absences`, `redistribution_plans` e `plan_items`. Mudança de estado só a partir do esperado. */
export interface RedistributionStore {
  absence(id: string): Promise<StoredAbsence | null>;
  createAbsence(input: { personId: string; startsAt: Date; endsAt: Date; kind: AbsenceKind }): Promise<string>;
  /** Ausências que começaram e terminaram há no máximo `sinceDays` dias, ou estão em curso. */
  recentAbsences(now: Date, sinceDays: number): Promise<StoredAbsence[]>;
  plansForAbsence(absenceId: string): Promise<StoredRedistribution[]>;
  createPlan(input: { trigger: PlanTrigger; absenceId?: string; absentId: string; items: NewPlanItem[] }): Promise<StoredRedistribution>;
  get(planId: string): Promise<StoredRedistribution | null>;
  planOfItem(itemId: string): Promise<StoredRedistribution | null>;
  inState(state: PlanState): Promise<StoredRedistribution[]>;
  setPlanState(planId: string, from: PlanState[], to: PlanState, patch?: { approvedBy?: string; approvedAt?: Date; choice?: unknown }): Promise<boolean>;
  updateItem(itemId: string, from: ItemState[], patch: { toId?: string | null; state?: ItemState; refusal?: string; reason?: string }): Promise<boolean>;
  /** Pessoas com conta no Linear (identities). */
  linearAccounts(): Promise<Set<string>>;
  teamLeader(teamId: string): Promise<string | null>;
  /** Tarefa que só existe no Echo (sem id no Linear): o responsável muda aqui mesmo, depois da aprovação. */
  assignLocalTask(taskId: string, toId: string): Promise<void>;
}

export interface RedistributionDeps {
  data: (orgId: string) => AgentData;
  store: (orgId: string) => RedistributionStore;
  outbox: (orgId: string) => { enqueue(action: OutboxAction): Promise<{ id: string; duplicate: boolean }> };
  recorder: RunRecorder;
  clock?: Clock;
  webUrl: string;
}

export type ProposeOutcome = { status: "created"; plan: StoredRedistribution } | { status: "skipped"; reason: string };
export type DecisionOutcome =
  | { status: "ok"; plan: StoredRedistribution; warnings: string[] }
  | { status: "denied" | "not_found" | "conflict" }
  | { status: "invalid"; reason: string };

export interface PlanChoice {
  /** Trocar a pessoa de um item (proposto ou sem responsável). */
  adjust?: { itemId: string; toId: string }[];
  /** Itens que a líder deixa de fora. */
  exclude?: string[];
}

// ---------- Textos, por regra

const KIND_LABEL: Record<AbsenceKind, string> = { vacation: "as férias", leave: "a licença", unexpected: "a ausência", ooo: "a ausência" };
const firstName = (people: Person[], id: string | undefined) => {
  const p = people.find((x) => x.id === id);
  return p ? (p.name.trim().split(/\s+/)[0] ?? p.name) : "alguém";
};

export function absenceTitle(absent: Person, people: Person[], absence: StoredAbsence | null, trigger: PlanTrigger): string {
  const who = firstName(people, absent.id);
  if (trigger === "leader_request") return `Plano pedido para as tarefas de ${who}`;
  if (trigger === "return") return `Volta de ${who}`;
  if (!absence) return `Plano para ${who}`;
  const from = localDate(absence.startsAt, absent.timezone);
  const to = localDate(new Date(absence.endsAt.getTime() - 1), absent.timezone);
  const span = from === to ? dayMonth(from) : `${from.slice(8, 10)} a ${dayMonth(to)}`;
  return `${trigger === "complement" ? "Plano complementar para" : "Plano para"} ${KIND_LABEL[absence.kind]} de ${who} (${span})`;
}

type Lookup = { tasks: Map<string, Task>; prs: Map<string, PullRequest>; people: Person[] };
const itemLabel = (i: { taskId?: string; prId?: string }, l: Lookup) =>
  i.taskId ? (l.tasks.get(i.taskId)?.key ?? "Tarefa") : `Revisão do PR ${l.prs.get(i.prId ?? "")?.number ?? "?"}`;

const PLAN_HOLD = "Nada muda até você aprovar.";
const planUrl = (webUrl: string, planId: string) => `${webUrl.replace(/\/$/, "")}/redistribuicao#plano-${planId}`;

export function planText(title: string, items: StoredPlanItem[], l: Lookup, webUrl: string, planId: string): string {
  const lines = items.map((i) =>
    i.toId ? `• ${itemLabel(i, l)} → ${firstName(l.people, i.toId)}. ${i.reason}` : `• ${itemLabel(i, l)} sem responsável. ${i.reason}`,
  );
  return [`*${title}*`, ...lines, PLAN_HOLD, `Abrir no painel: ${planUrl(webUrl, planId)}`].join("\n");
}

/** O plano em blocos para a liderança: cada item com responsável e motivo, e o botão para decidir no painel. */
export function planBlocks(title: string, items: StoredPlanItem[], l: Lookup, webUrl: string, planId: string): unknown[] {
  const lines = items.map((i) =>
    i.toId ? `\`${esc(itemLabel(i, l))}\` → *${esc(firstName(l.people, i.toId))}*\n${esc(i.reason)}` : `${DOT.wait} \`${esc(itemLabel(i, l))}\` sem responsável\n${esc(i.reason)}`,
  );
  return [
    header(title),
    statusTag(DOT.wait, "ESPERA SUA APROVAÇÃO", PLAN_HOLD),
    ...sectionsOf(lines),
    actions(linkButton("abrir_redistribuicao", "Abrir no painel", planUrl(webUrl, planId), true)),
  ];
}

/** Aviso a quem recebe o trabalho, com o caminho para recusar a um clique. */
const handoverBlocks = (text: string, webUrl: string) => [section(esc(text)), actions(linkButton("abrir_redistribuicao", "Abrir Redistribuição", `${webUrl.replace(/\/$/, "")}/redistribuicao`))];

// ---------- Fluxo

const RECENT_DAYS = 7;

export function createRedistribution(deps: RedistributionDeps) {
  const clock = deps.clock ?? systemClock;
  const record = (run: AgentRun) => deps.recorder.record(run).catch(() => undefined);

  async function context(orgId: string) {
    const data = deps.data(orgId);
    const [people, tasks, prs, absences, settings] = await Promise.all([data.people(), data.tasks({ openOnly: true }), data.pullRequests({ openOnly: true }), data.absences(), data.orgSettings()]);
    const lookup: Lookup = { tasks: new Map(tasks.map((t) => [t.id, t])), prs: new Map(prs.map((p) => [p.id, p])), people };
    return { data, people, tasks, prs, absences, settings, lookup };
  }

  async function leadersOf(orgId: string, absent: Person, people: Person[]): Promise<string[]> {
    const lead = absent.teamId ? await deps.store(orgId).teamLeader(absent.teamId) : null;
    const ids = lead ? [lead] : people.filter((p) => p.role === "leader" && p.active && p.teamId === absent.teamId).map((p) => p.id);
    return ids.filter((id) => id !== absent.id);
  }

  /** Grava o plano e avisa a liderança em privado. Sem nada a passar, não há plano. */
  async function createAndNotify(orgId: string, input: { trigger: PlanTrigger; absence: StoredAbsence | null; absent: Person; items: NewPlanItem[] }, ctx: Awaited<ReturnType<typeof context>>): Promise<StoredRedistribution | null> {
    if (input.items.length === 0) return null;
    const store = deps.store(orgId);
    const plan = await store.createPlan({ trigger: input.trigger, ...(input.absence ? { absenceId: input.absence.id } : {}), absentId: input.absent.id, items: input.items });
    const title = absenceTitle(input.absent, ctx.people, input.absence, input.trigger);
    const text = planText(title, plan.items, ctx.lookup, deps.webUrl, plan.id);
    const blocks = planBlocks(title, plan.items, ctx.lookup, deps.webUrl, plan.id);
    for (const leaderId of await leadersOf(orgId, input.absent, ctx.people)) {
      await deps.outbox(orgId).enqueue({ type: "slack.dm", target: `person:${leaderId}`, payload: { personId: leaderId, text, blocks }, idempotencyKey: `redistribution_plan:${plan.id}:${leaderId}` });
    }
    return plan;
  }

  const toItems = (r: { assignments: PlanAssignment[]; unassigned: PlanAssignment[] }): NewPlanItem[] => [
    ...r.assignments.map((a): NewPlanItem => ({ ...(a.taskId ? { taskId: a.taskId } : {}), ...(a.prId ? { prId: a.prId } : {}), fromId: a.fromId, ...(a.toId ? { toId: a.toId } : {}), reason: a.reason, state: "proposed" })),
    ...r.unassigned.map((a): NewPlanItem => ({ ...(a.taskId ? { taskId: a.taskId } : {}), ...(a.prId ? { prId: a.prId } : {}), fromId: a.fromId, reason: a.reason, state: "unassigned" })),
  ];

  async function buildPlan(orgId: string, absentId: string, taskFilter: (t: Task) => boolean, withReviews: boolean, ctx: Awaited<ReturnType<typeof context>>) {
    const linear = await deps.store(orgId).linearAccounts();
    const candidates = planCandidates({ absentId, people: ctx.people, tasks: ctx.tasks, pullRequests: ctx.prs, absences: ctx.absences, linearAccounts: linear, teamLimit: (team) => (team ? ctx.settings.teamLoadLimits[team] : undefined) ?? 12, now: clock.now() });
    const result = planOptions({ absentId, tasks: ctx.tasks.filter((t) => t.assigneeId === absentId && taskFilter(t)), reviews: withReviews ? ctx.prs : [], candidates, now: clock.now() });
    return { candidates, items: toItems(result) };
  }

  const finishRun = (flow: string, orgId: string, started: number, result: AgentRun["result"], extra: Partial<AgentRun> = {}) =>
    record({ flow, orgId, durationMs: Math.round(performance.now() - started), result, ...extra });

  /** Painel: ausência com as datas locais de quem se ausenta. Quem chama enfileira `absence.registered`. */
  async function registerAbsence(orgId: string, by: string, input: { personId: string; startDate: string; endDate: string; kind: AbsenceKind }): Promise<{ status: "registered"; absenceId: string } | { status: "denied" | "invalid" }> {
    const people = await deps.data(orgId).people();
    const who = people.find((p) => p.id === by);
    const person = people.find((p) => p.id === input.personId);
    if (!who || !person || !canRegisterAbsence(who, person)) return { status: "denied" };
    const range = absenceRange(input.startDate, input.endDate, person.timezone);
    if (!range) return { status: "invalid" };
    const absenceId = await deps.store(orgId).createAbsence({ personId: person.id, ...range, kind: input.kind });
    return { status: "registered", absenceId };
  }

  /** Gatilho de ausência (painel, RH ou agenda): um plano por ausência, esperando a liderança. */
  async function propose(orgId: string, absenceId: string): Promise<ProposeOutcome> {
    const started = performance.now();
    const store = deps.store(orgId);
    const absence = await store.absence(absenceId);
    const skip = async (reason: string) => (await finishRun("redistribution_plan", orgId, started, "skipped", { error: reason }), { status: "skipped", reason } as const);
    if (!absence || absence.cancelled) return skip("ausência inexistente ou cancelada");
    if ((await store.plansForAbsence(absenceId)).some((p) => p.trigger !== "return" && p.trigger !== "complement")) return skip("ausência já tem plano");
    const ctx = await context(orgId);
    const absent = ctx.people.find((p) => p.id === absence.personId);
    if (!absent) return skip("pessoa não encontrada");
    const { items } = await buildPlan(orgId, absent.id, () => true, true, ctx);
    const plan = await createAndNotify(orgId, { trigger: absence.kind === "unexpected" ? "unexpected" : "vacation", absence, absent, items }, ctx);
    if (!plan) return skip("nada a redistribuir");
    await finishRun("redistribution_plan", orgId, started, "ok", { tools: ["slack.dm"] });
    return { status: "created", plan };
  }

  /** Pedido da liderança, sem ausência (ex.: pessoa sobrecarregada). */
  async function requestPlan(orgId: string, by: string, personId: string): Promise<ProposeOutcome | { status: "denied" }> {
    const started = performance.now();
    const ctx = await context(orgId);
    const who = ctx.people.find((p) => p.id === by);
    const absent = ctx.people.find((p) => p.id === personId);
    if (!who || !absent || !canApprovePlan(who, absent, absent.teamId ? ((await deps.store(orgId).teamLeader(absent.teamId)) ?? undefined) : undefined)) return { status: "denied" };
    const { items } = await buildPlan(orgId, absent.id, () => true, true, ctx);
    const plan = await createAndNotify(orgId, { trigger: "leader_request", absence: null, absent, items }, ctx);
    await finishRun("redistribution_plan", orgId, started, plan ? "ok" : "skipped", plan ? { tools: ["slack.dm"] } : { error: "nada a redistribuir" });
    return plan ? { status: "created", plan } : { status: "skipped", reason: "nada a redistribuir" };
  }

  async function authorize(orgId: string, by: string, plan: StoredRedistribution, ctx: Awaited<ReturnType<typeof context>>) {
    const who = ctx.people.find((p) => p.id === by);
    const absent = ctx.people.find((p) => p.id === plan.absentId);
    if (!who || !absent) return null;
    const lead = absent.teamId ? ((await deps.store(orgId).teamLeader(absent.teamId)) ?? undefined) : undefined;
    return canApprovePlan(who, absent, lead) ? { who, absent } : null;
  }

  /** Ações de um item aprovado. Chave com a pessoa: trocar de novo depois de uma recusa gera ações novas. */
  async function enqueueItem(orgId: string, plan: StoredRedistribution, item: StoredPlanItem, toId: string, approver: Person, ctx: Awaited<ReturnType<typeof context>>, absence: StoredAbsence | null) {
    const outbox = deps.outbox(orgId);
    const store = deps.store(orgId);
    const key = `redistribution:${item.id}:${toId}`;
    const absent = ctx.people.find((p) => p.id === plan.absentId)!;
    const span = absence ? ` durante ${KIND_LABEL[absence.kind]} de ${firstName(ctx.people, absent.id)} (até ${dayMonth(localDate(new Date(absence.endsAt.getTime() - 1), absent.timezone))})` : "";
    const why = plan.trigger === "return" ? `, na volta de ${firstName(ctx.people, toId)}` : span;
    if (item.taskId) {
      const task = ctx.lookup.tasks.get(item.taskId);
      if (!task) return;
      if (task.hasLinearId) {
        await outbox.enqueue({ type: "linear.assign", target: `linear:${task.key}`, payload: { taskKey: task.key, toPersonId: toId, planItemId: item.id }, idempotencyKey: `${key}:assign`, approvedBy: approver.id });
        await outbox.enqueue({
          type: "linear.comment",
          target: `linear:${task.key}`,
          payload: { taskKey: task.key, body: `Responsável alterado de ${firstName(ctx.people, item.fromId)} para ${firstName(ctx.people, toId)}${why}, com aprovação de ${firstName(ctx.people, approver.id)}. Motivo: ${item.reason} — Echo` },
          idempotencyKey: `${key}:comment`,
          approvedBy: approver.id,
        });
      } else {
        await store.assignLocalTask(task.id, toId);
        await store.updateItem(item.id, ["approved"], { state: "done" });
      }
      const text =
        plan.trigger === "return"
          ? `${task.key} voltou para você, com aprovação de ${firstName(ctx.people, approver.id)}.`
          : `${firstName(ctx.people, approver.id)} aprovou: ${task.key} passa para você${span}. ${item.reason} Se não puder assumir, recuse com o motivo em Redistribuição.`;
      await outbox.enqueue({ type: "slack.dm", target: `person:${toId}`, payload: { personId: toId, text, ...(plan.trigger === "return" ? {} : { blocks: handoverBlocks(text, deps.webUrl) }) }, idempotencyKey: `${key}:dm` });
    } else if (item.prId) {
      const pr = ctx.lookup.prs.get(item.prId);
      if (!pr) return;
      await outbox.enqueue({ type: "github.set_reviewers", target: `github:${pr.repository}#${pr.number}`, payload: { repo: pr.repository, number: pr.number, personIds: [toId], planItemId: item.id }, idempotencyKey: `${key}:reviewers`, approvedBy: approver.id });
      const text = `${firstName(ctx.people, approver.id)} aprovou: a revisão do PR ${pr.number} passa para você${span}. Se não puder, recuse com o motivo em Redistribuição.`;
      await outbox.enqueue({
        type: "slack.dm",
        target: `person:${toId}`,
        payload: { personId: toId, text, blocks: handoverBlocks(text, deps.webUrl) },
        idempotencyKey: `${key}:dm`,
      });
    }
  }

  /** A líder aprova, ajusta ou deixa itens de fora. Só então as ações entram no outbox, com a aprovação dela. */
  async function approve(orgId: string, by: string, planId: string, choice: PlanChoice = {}): Promise<DecisionOutcome> {
    const started = performance.now();
    const store = deps.store(orgId);
    const plan = await store.get(planId);
    if (!plan) return { status: "not_found" };
    const ctx = await context(orgId);
    const auth = await authorize(orgId, by, plan, ctx);
    if (!auth) return (await finishRun("redistribution_approve", orgId, started, "refused", { error: "sem permissão" }), { status: "denied" });
    if (plan.state !== "awaiting_leader") return { status: "conflict" };

    const { candidates } = await buildPlan(orgId, plan.absentId, () => false, false, ctx);
    const excluded = new Set(choice.exclude ?? []);
    const adjust = new Map((choice.adjust ?? []).map((a) => [a.itemId, a.toId]));
    const warnings: string[] = [];
    const finalTo = new Map<string, string | undefined>();
    for (const item of plan.items) {
      if (excluded.has(item.id)) continue;
      const to = adjust.get(item.id) ?? item.toId;
      if (adjust.has(item.id)) {
        if (item.state !== "proposed" && item.state !== "unassigned") return { status: "invalid", reason: `item ${item.id} não pode mudar` };
        const target = item.taskId ? ctx.lookup.tasks.get(item.taskId) : undefined;
        const pr = item.prId ? ctx.lookup.prs.get(item.prId) : undefined;
        const check = target ? adjustmentCheck({ kind: "task", task: target }, candidates.find((c) => c.person.id === to), clock.now()) : pr ? adjustmentCheck({ kind: "review", pr }, candidates.find((c) => c.person.id === to), clock.now()) : null;
        if (!check || !check.ok) return { status: "invalid", reason: `${itemLabel(item, ctx.lookup)}: ${check && !check.ok ? check.reason : "item não encontrado"}` };
        if (check.overLimit) warnings.push(`${itemLabel(item, ctx.lookup)}: ${firstName(ctx.people, to)} passa do limite de carga`);
      }
      finalTo.set(item.id, to);
    }
    if (!(await store.setPlanState(planId, ["awaiting_leader"], "executing", { approvedBy: by, approvedAt: clock.now(), choice }))) return { status: "conflict" };

    const absence = plan.absenceId ? await store.absence(plan.absenceId) : null;
    for (const item of plan.items) {
      if (excluded.has(item.id)) {
        await store.updateItem(item.id, ["proposed", "unassigned"], { state: "excluded" });
        continue;
      }
      const to = finalTo.get(item.id);
      if (!to) continue; // segue sem responsável, com o motivo
      const ok = await store.updateItem(item.id, ["proposed", "unassigned"], { toId: to, state: "approved", ...(adjust.has(item.id) ? { reason: "Escolhida pela liderança." } : {}) });
      if (ok) await enqueueItem(orgId, plan, { ...item, toId: to, ...(adjust.has(item.id) ? { reason: "Escolhida pela liderança." } : {}) }, to, auth.who, ctx, absence);
    }
    const updated = (await store.get(planId))!;
    await finishRun("redistribution_approve", orgId, started, "ok", { tools: ["linear.assign", "linear.comment", "github.set_reviewers", "slack.dm"].filter((t) => updated.items.some((i) => i.state !== "excluded" && i.toId && (t.startsWith("github") ? i.prId : t.startsWith("linear") ? i.taskId : true))) });
    return { status: "ok", plan: updated, warnings };
  }

  async function reject(orgId: string, by: string, planId: string): Promise<DecisionOutcome> {
    const started = performance.now();
    const store = deps.store(orgId);
    const plan = await store.get(planId);
    if (!plan) return { status: "not_found" };
    const ctx = await context(orgId);
    if (!(await authorize(orgId, by, plan, ctx))) return { status: "denied" };
    if (!(await store.setPlanState(planId, ["awaiting_leader"], "rejected", { approvedBy: by, approvedAt: clock.now() }))) return { status: "conflict" };
    await finishRun("redistribution_reject", orgId, started, "ok");
    return { status: "ok", plan: (await store.get(planId))!, warnings: [] };
  }

  /** Quem recebeu recusa com motivo. O item volta para a liderança, e o motivo não vai na mensagem. */
  async function refuse(orgId: string, by: string, itemId: string, reason: string): Promise<{ status: "refused" } | { status: "denied" | "not_found" | "invalid" | "conflict" }> {
    const started = performance.now();
    if (!reason.trim()) return { status: "invalid" };
    const store = deps.store(orgId);
    const plan = await store.planOfItem(itemId);
    const item = plan?.items.find((i) => i.id === itemId);
    if (!plan || !item) return { status: "not_found" };
    if (item.toId !== by) return { status: "denied" };
    // Só depois da mudança feita: o executor marca o item como `done` ao terminar, e sobrescreveria a recusa.
    if (!(await store.updateItem(itemId, ["done"], { state: "refused", refusal: reason.trim().slice(0, 500) }))) return { status: "conflict" };
    const ctx = await context(orgId);
    const absent = ctx.people.find((p) => p.id === plan.absentId);
    const leaders = plan.approvedBy ? [plan.approvedBy] : absent ? await leadersOf(orgId, absent, ctx.people) : [];
    for (const leaderId of leaders) {
      await deps.outbox(orgId).enqueue({
        type: "slack.dm",
        target: `person:${leaderId}`,
        payload: { personId: leaderId, text: `${firstName(ctx.people, by)} não pode assumir ${itemLabel(item, ctx.lookup)}. Escolha outra pessoa em Redistribuição.` },
        idempotencyKey: `redistribution_refused:${itemId}:${by}`,
      });
    }
    // Se a mudança já estava pronta, o plano volta a ter pendência.
    await store.setPlanState(plan.id, ["done"], "executing");
    await finishRun("redistribution_refuse", orgId, started, "ok", { tools: ["slack.dm"] });
    return { status: "refused" };
  }

  /** A liderança passa um item recusado, sem responsável ou que falhou para outra pessoa. */
  async function reassign(orgId: string, by: string, itemId: string, toId: string): Promise<DecisionOutcome> {
    const started = performance.now();
    const store = deps.store(orgId);
    const plan = await store.planOfItem(itemId);
    const item = plan?.items.find((i) => i.id === itemId);
    if (!plan || !item) return { status: "not_found" };
    const ctx = await context(orgId);
    const auth = await authorize(orgId, by, plan, ctx);
    if (!auth) return { status: "denied" };
    if (plan.state !== "executing" && plan.state !== "done") return { status: "conflict" };
    const { candidates } = await buildPlan(orgId, plan.absentId, () => false, false, ctx);
    const task = item.taskId ? ctx.lookup.tasks.get(item.taskId) : undefined;
    const pr = item.prId ? ctx.lookup.prs.get(item.prId) : undefined;
    const check = task ? adjustmentCheck({ kind: "task", task }, candidates.find((c) => c.person.id === toId), clock.now()) : pr ? adjustmentCheck({ kind: "review", pr }, candidates.find((c) => c.person.id === toId), clock.now()) : null;
    if (!check || !check.ok) return { status: "invalid", reason: check && !check.ok ? check.reason : "item não está mais aberto" };
    if (item.toId === toId) return { status: "invalid", reason: "mesma pessoa" };
    if (!(await store.updateItem(itemId, ["refused", "unassigned", "failed"], { toId, state: "approved", reason: "Escolhida pela liderança." }))) return { status: "conflict" };
    await store.setPlanState(plan.id, ["done"], "executing");
    const absence = plan.absenceId ? await store.absence(plan.absenceId) : null;
    await enqueueItem(orgId, plan, { ...item, toId, reason: "Escolhida pela liderança." }, toId, auth.who, ctx, absence);
    await finishRun("redistribution_reassign", orgId, started, "ok");
    return { status: "ok", plan: (await store.get(plan.id))!, warnings: check.overLimit ? [`${firstName(ctx.people, toId)} passa do limite de carga`] : [] };
  }

  /** Plano sem item aprovado pendente: concluído, com resumo para a liderança. */
  async function sync(orgId: string): Promise<{ done: number }> {
    const store = deps.store(orgId);
    let done = 0;
    for (const plan of await store.inState("executing")) {
      if (plan.items.some((i) => i.state === "approved")) continue;
      if (!(await store.setPlanState(plan.id, ["executing"], "done"))) continue;
      done++;
      const ctx = await context(orgId);
      const lines = plan.items.flatMap((i) => {
        const label = itemLabel(i, ctx.lookup);
        if (i.state === "done") return [i.taskId ? `${label} mudou de responsável${ctx.lookup.tasks.get(i.taskId)?.hasLinearId === false ? "" : " no Linear"}, para ${firstName(ctx.people, i.toId)}.` : `${label} pedida a ${firstName(ctx.people, i.toId)}.`];
        if (i.state === "failed") return [`${label} não mudou: veja em Redistribuição.`];
        if (i.state === "refused") return [`${label} foi recusada e espera outra pessoa.`];
        if (i.state === "unassigned") return [`${label} segue sem responsável.`];
        return [];
      });
      if (plan.approvedBy) {
        await deps.outbox(orgId).enqueue({
          type: "slack.dm",
          target: `person:${plan.approvedBy}`,
          payload: {
            personId: plan.approvedBy,
            text: [`Plano aprovado por ${firstName(ctx.people, plan.approvedBy)} executado.`, ...lines].join(" "),
            blocks: [header("Plano executado"), contextBlock(`Aprovado por ${esc(firstName(ctx.people, plan.approvedBy))}`), ...sectionsOf(lines.map((l) => `• ${esc(l)}`))],
          },
          idempotencyKey: `redistribution_done:${plan.id}:${plan.items.map((i) => i.state[0]).join("")}`,
        });
      }
      await record({ flow: "redistribution_done", orgId, durationMs: 0, result: plan.items.some((i) => i.state === "failed") ? "failed" : "ok", tools: ["slack.dm"] });
    }
    return { done };
  }

  /**
   * Agenda: durante a ausência, tarefas novas da pessoa viram plano complementar; na volta, a pessoa recebe o
   * resumo e a liderança, um plano de devolução para decidir.
   */
  async function scan(orgId: string): Promise<{ complements: number; returns: number }> {
    const out = { complements: 0, returns: 0 };
    const store = deps.store(orgId);
    const now = clock.now();
    const absences = await store.recentAbsences(now, RECENT_DAYS);
    if (absences.length === 0) return out;
    const ctx = await context(orgId);
    for (const absence of absences) {
      if (absence.cancelled) continue;
      const absent = ctx.people.find((p) => p.id === absence.personId);
      if (!absent) continue;
      const plans = await store.plansForAbsence(absence.id);
      const main = plans.find((p) => p.trigger === "vacation" || p.trigger === "unexpected");
      if (!main || main.state === "awaiting_leader" || main.state === "rejected") continue;
      const ongoing = absence.startsAt.getTime() <= now.getTime() && now.getTime() < absence.endsAt.getTime();

      if (ongoing) {
        if (plans.some((p) => p.trigger === "complement" && p.state === "awaiting_leader")) continue;
        const planned = new Set(plans.flatMap((p) => p.items.flatMap((i) => (i.taskId ? [i.taskId] : []))));
        const fresh = new Set(complementTasks(absent.id, ctx.tasks, planned).map((t) => t.id));
        if (fresh.size === 0) continue;
        const started = performance.now();
        const { items } = await buildPlan(orgId, absent.id, (t) => fresh.has(t.id), false, ctx);
        if (await createAndNotify(orgId, { trigger: "complement", absence, absent, items }, ctx)) {
          out.complements++;
          await finishRun("redistribution_plan", orgId, started, "ok", { tools: ["slack.dm"] });
        }
        continue;
      }

      // Volta: só quando a pessoa já está de volta ao expediente, uma vez por ausência.
      if (now.getTime() < absence.endsAt.getTime() || isAway(absent, ctx.absences, now).away || plans.some((p) => p.trigger === "return")) continue;
      const started = performance.now();
      const passed = plans
        .filter((p) => p.trigger !== "return")
        .flatMap((p) => p.items.flatMap((i) => (i.taskId && i.toId && i.state === "done" ? [{ itemId: i.id, taskId: i.taskId, holderId: i.toId }] : [])));
      const proposals = returnProposals(passed, ctx.tasks, absent.id);
      const summary = passed.length
        ? `Bem-vindo de volta. Durante ${KIND_LABEL[absence.kind]}: ${passed.map((p) => `${ctx.lookup.tasks.get(p.taskId)?.key ?? "tarefa"} ficou com ${firstName(ctx.people, p.holderId)}`).join("; ")}. A liderança decide o que volta para você.`
        : "Bem-vindo de volta. Nada foi passado adiante durante a sua ausência.";
      await deps.outbox(orgId).enqueue({ type: "slack.dm", target: `person:${absent.id}`, payload: { personId: absent.id, text: summary }, idempotencyKey: `redistribution_return:${absence.id}` });
      const plan = await createAndNotify(orgId, { trigger: "return", absence, absent, items: proposals.map((p) => ({ taskId: p.taskId, fromId: p.fromId, toId: p.toId, reason: p.reason, state: "proposed" as const })) }, ctx);
      if (!plan) await store.createPlan({ trigger: "return", absenceId: absence.id, absentId: absent.id, items: [] });
      out.returns++;
      await finishRun("redistribution_return", orgId, started, "ok", { tools: ["slack.dm"] });
    }
    return out;
  }

  return { registerAbsence, propose, requestPlan, approve, reject, refuse, reassign, sync, scan };
}

export type Redistribution = ReturnType<typeof createRedistribution>;
