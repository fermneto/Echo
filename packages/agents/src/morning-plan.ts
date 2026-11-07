// Plano da manhã (etapa 9, F5). Sem modelo: as regras coletam, ordenam e escrevem o motivo de cada item.
// Envio privado pelo outbox; em Meu plano, só a própria pessoa reordena e descarta.
import type { OutboxAction } from "@echo/actions";
import { applyPlanEdits, type Clock, DAY, MORNING_RULES, morningPlan, type PlanFinding, type PlanFix, type PlanItem, type PlanQuestion, systemClock } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import type { AgentData } from "./data.ts";

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

export function planMessage(plan: StoredPlan, webUrl: string): { text: string; blocks: unknown[] } {
  const lines = [
    "*Seu plano de hoje*",
    ...plan.items.slice(0, MORNING_RULES.maxItems).map((i) => `• *${i.text}* — ${i.reason}`),
    ...(plan.items.length > MORNING_RULES.maxItems ? [`E mais ${plan.items.length - MORNING_RULES.maxItems} no painel.`] : []),
    "Só você vê este plano.",
  ];
  const text = lines.join("\n");
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "actions", elements: [{ type: "button", action_id: "abrir_plano", text: { type: "plain_text", text: "Abrir Meu plano" }, url: `${webUrl.replace(/\/$/, "")}/plano?data=${plan.date}` }] },
    ],
  };
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
      const [questions, findings, fixes, prs, tasks] = await Promise.all([
        store.questionsForOwner(personId, since),
        store.findingsForAuthor(personId, new Date(now.getTime() - 2 * DAY)),
        store.fixesForAuthor(personId),
        data.pullRequests({ openOnly: true }),
        data.tasks({ assigneeId: personId, openOnly: true }),
      ]);
      const { all: items } = morningPlan({ person, people, now, questions, pullRequests: prs, tasks, findings, fixes });
      const plan: StoredPlan = { personId, date, items };
      if (!(await store.create(plan))) return done({ status: "skipped", reason: "plano já existe nesta data" });

      // Sem item, o plano fica no painel e não há mensagem.
      const slackUser = items.length ? await store.slackUserOf(personId) : null;
      let dmQueued = false;
      if (slackUser) {
        const msg = planMessage(plan, deps.webUrl);
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
