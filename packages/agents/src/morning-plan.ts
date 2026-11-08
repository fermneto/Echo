// Plano da manhã (etapa 9, F5). Sem modelo: as regras coletam, ordenam e escrevem o motivo de cada item.
// Envio privado pelo outbox; em Meu plano, só a própria pessoa reordena e descarta.
import type { OutboxAction } from "@echo/actions";
import { applyPlanEdits, type Clock, DAY, MORNING_RULES, morningPlan, type PersonSchedule, personSchedule, type PlanFinding, type PlanFix, type PlanItem, type PlanItemKind, type PlanQuestion, scheduleDayLabel, type SchedulePart, systemClock } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import type { AgentData } from "./data.ts";
import { actions, columns, context, dayMonth, divider, DOT, esc, header, linkButton, section, statusTag } from "./slack-format.ts";

/** Todos os itens, em ordem: a mensagem mostra os 7 primeiros, e o painel mostra o resto em "ver mais". */
export interface StoredPlan {
  personId: string;
  date: string;
  items: PlanItem[];
}

export interface PlanStore {
  /** Perguntas que precisam da pessoa e ainda não foram resolvidas. */
  questionsForOwner(personId: string, since: Date): Promise<PlanQuestion[]>;
  /** Achados da análise noturna nos PRs abertos da pessoa. */
  findingsForAuthor(personId: string, since: Date): Promise<PlanFinding[]>;
  /** Correções prontas nos PRs abertos da pessoa, esperando aprovação (etapa 10). */
  fixesForAuthor(personId: string): Promise<PlanFix[]>;
  get(personId: string, date: string): Promise<StoredPlan | null>;
  /** False se já existe plano da pessoa nessa data (chave única). */
  create(plan: StoredPlan): Promise<boolean>;
  updateItems(personId: string, date: string, items: PlanItem[]): Promise<boolean>;
  /** Dias que a própria pessoa escolheu para as tarefas (Meu plano). */
  schedulePins?(personId: string): Promise<Record<string, string>>;
  slackUserOf(personId: string): Promise<string | null>;
}

export interface MorningPlanDeps {
  data: (orgId: string) => AgentData;
  plans: (orgId: string) => PlanStore;
  outbox: (orgId: string) => { enqueue(action: OutboxAction): Promise<{ id: string; duplicate: boolean }> };
  recorder: RunRecorder;
  clock?: Clock;
  webUrl: string;
}

export type PlanOutcome = { status: "created"; plan: StoredPlan; dmQueued: boolean } | { status: "skipped"; reason: string };

/** O ponto diz de quem é a vez: o agente já preparou, a pendência espera a pessoa, ou algo falhou. */
const PLAN_DOT: Record<PlanItemKind, string> = {
  fix_ready: DOT.agent,
  finding: DOT.agent,
  question: DOT.wait,
  review_request: DOT.wait,
  own_pr_waiting: DOT.wait,
  task_due: DOT.wait,
  task_overdue: DOT.error,
  ci_failed: DOT.error,
};

const PART_LABEL: Record<SchedulePart, string> = { inteira: "fazer", inicia: "começar", continua: "continuar", conclui: "terminar" };

/**
 * A mensagem da manhã é a agenda do dia: o que fazer hoje e por quê, quem espera a pessoa, os próximos dias e o que
 * está parado por outra entrega. Prazo já aparece na agenda, então não repete como pendência.
 */
export function planMessage(plan: StoredPlan, webUrl: string, schedule?: PersonSchedule, agentName?: string): { text: string; blocks: unknown[] } {
  const today = schedule?.days.find((d) => d.date === plan.date);
  const next = (schedule?.days ?? []).filter((d) => d.date > plan.date).slice(0, 4);
  const pending = schedule ? plan.items.filter((i) => i.kind !== "task_due" && i.kind !== "task_overdue") : plan.items;
  const shown = pending.slice(0, MORNING_RULES.maxItems);
  const more = pending.length - shown.length;
  const moreLine = more > 0 ? `E mais ${more} no painel.` : "";
  const waitLine = (w: PersonSchedule["waiting"][number]) => `\`${esc(w.key)}\` espera ${w.waitingOn.map((b) => `\`${esc(b.key)}\`${b.owner ? ` de ${esc(b.owner)}` : ""}`).join(", ")}`;
  const lines = [
    "*Seu plano de hoje*",
    ...(today?.entries ?? []).map((e) => `${PART_LABEL[e.part]} ${esc(e.key)}: ${esc(e.title)} (${esc(e.reason)})`),
    ...shown.map((i) => `• *${esc(i.text)}* — ${esc(i.reason)}`),
    ...(moreLine ? [moreLine] : []),
    "Só você vê este plano.",
  ];
  const blocks: unknown[] = [
    header("Seu plano de hoje"),
    schedule ? statusTag(DOT.agent, "AGENDA DO DIA", `${agentName ? `${esc(agentName)} · ` : ""}\`${dayMonth(plan.date)}\` · só você vê`) : context(`\`${dayMonth(plan.date)}\` · Só você vê este plano.`),
  ];
  if (today?.entries.length) {
    blocks.push(section("*Hoje, nesta ordem*"));
    today.entries.forEach((e, i) => blocks.push(section(`${e.late ? `${DOT.error} ` : ""}*${i + 1}.* \`${esc(e.key)}\` *${esc(e.title)}*\n${PART_LABEL[e.part]} · ${esc(e.reason)}`)));
  } else if (schedule) {
    blocks.push(section("*Hoje*\nNenhuma tarefa na agenda."));
  }
  if (shown.length) {
    blocks.push(divider(), section("*Esperam você*"), ...shown.map((i) => section(`${PLAN_DOT[i.kind]} *${esc(i.text)}*\n${esc(i.reason)}`)));
    if (moreLine) blocks.push(context(moreLine));
  }
  if (next.length) {
    blocks.push(divider(), columns(...next.map((d) => `*${scheduleDayLabel(d.date, plan.date)}*\n${d.entries.map((e) => `\`${esc(e.key)}\` ${PART_LABEL[e.part]}`).join("\n") || "Livre"}`)));
  }
  if (schedule?.waiting.length) blocks.push(divider(), section(`${DOT.wait} *Esperando outra entrega*\n${schedule.waiting.map((w) => `• ${waitLine(w)}`).join("\n")}`));
  if (schedule?.later.length) blocks.push(context(`Mais ${schedule.later.length} depois dos próximos dias.`));
  blocks.push(actions(linkButton("abrir_plano", "Abrir Meu plano", `${webUrl.replace(/\/$/, "")}/plano?data=${plan.date}`, true)));
  return { text: lines.join("\n"), blocks };
}

export function createMorningPlan(deps: MorningPlanDeps) {
  const clock = deps.clock ?? systemClock;
  const record = (run: AgentRun) => deps.recorder.record(run).catch(() => undefined);

  async function build(orgId: string, personId: string, date: string): Promise<PlanOutcome> {
    const started = performance.now();
    const done = async (o: PlanOutcome, error?: string) => {
      await record({ flow: "morning_plan", orgId, durationMs: Math.round(performance.now() - started), result: o.status === "created" ? "ok" : "skipped", ...(o.status === "skipped" ? { error: o.reason } : error ? { error } : {}), tools: o.status === "created" && o.dmQueued ? ["slack.dm"] : [] });
      return o;
    };
    const data = deps.data(orgId);
    const store = deps.plans(orgId);
    const now = clock.now();
    try {
      const people = await data.people();
      const person = people.find((p) => p.id === personId);
      if (!person || !person.active || person.role === "hr") return done({ status: "skipped", reason: "pessoa sem plano da manhã" });
      if (await store.get(personId, date)) return done({ status: "skipped", reason: "plano já existe nesta data" });

      const since = new Date(now.getTime() - 7 * DAY);
      const [questions, findings, fixes, prs, tasks, openTasks, absences, pins] = await Promise.all([
        store.questionsForOwner(personId, since),
        store.findingsForAuthor(personId, new Date(now.getTime() - 2 * DAY)),
        store.fixesForAuthor(personId),
        data.pullRequests({ openOnly: true }),
        data.tasks({ assigneeId: personId, openOnly: true }),
        data.tasks({ openOnly: true }),
        data.absences(),
        store.schedulePins?.(personId) ?? {},
      ]);
      const { all: items } = morningPlan({ person, people, now, questions, pullRequests: prs, tasks, findings, fixes });
      const plan: StoredPlan = { personId, date, items };
      if (!(await store.create(plan))) return done({ status: "skipped", reason: "plano já existe nesta data" });

      const schedule = personSchedule({ person, people, tasks: openTasks, absences, now, pins });
      // Sem pendência e sem tarefa na agenda, o plano fica no painel e não há mensagem.
      const hasWork = schedule.days.some((d) => d.entries.length > 0) || schedule.waiting.length > 0;
      const slackUser = items.length || hasWork ? await store.slackUserOf(personId) : null;
      let dmQueued = false;
      if (slackUser) {
        const msg = planMessage(plan, deps.webUrl, schedule, `Agente de ${person.name.trim().split(/\s+/)[0]}`);
        const r = await deps.outbox(orgId).enqueue({ type: "slack.dm", target: `person:${personId}`, payload: { personId, text: msg.text, blocks: msg.blocks }, idempotencyKey: `morning_plan:${personId}:${date}` });
        dmQueued = !r.duplicate;
      }
      return done({ status: "created", plan, dmQueued });
    } catch (err) {
      await record({ flow: "morning_plan", orgId, durationMs: Math.round(performance.now() - started), result: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Meu plano: reordenar e descartar. Só a própria pessoa. */
  async function edit(orgId: string, byPersonId: string, personId: string, date: string, edits: { order?: string[]; dismiss?: string[] }): Promise<{ status: "ok"; items: PlanItem[] } | { status: "denied" | "not_found" }> {
    if (byPersonId !== personId) return { status: "denied" };
    const store = deps.plans(orgId);
    const plan = await store.get(personId, date);
    if (!plan) return { status: "not_found" };
    const items = applyPlanEdits(plan.items, edits);
    await store.updateItems(personId, date, items);
    return { status: "ok", items };
  }

  return { build, edit };
}

export type MorningPlan = ReturnType<typeof createMorningPlan>;
export { MORNING_RULES };
