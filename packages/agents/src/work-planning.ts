// Distribuição e agenda do trabalho, sem modelo. A liderança atribui a tarefa (com aprovação registrada no outbox,
// que é quem escreve no Linear ou no Jira); as regras de @echo/domain sugerem em que dia ela entra, e só a própria
// pessoa muda esse dia. A agenda fica no Echo: nada dela vai para o tracker.
import type { OutboxAction } from "@echo/actions";
import { assignCheck, type Clock, localDate, type Person, personSchedule, type PersonSchedule, SCHEDULE_RULES, scheduleDayLabel, systemClock, type Task, validPin } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import type { AgentData } from "./data.ts";
import { actions, columns, context, dayMonth, DOT, esc, header, linkButton, section, statusTag } from "./slack-format.ts";

export interface WorkPlanningStore {
  /** Tarefa → dia escolhido pela pessoa. */
  pins(personId: string): Promise<Record<string, string>>;
  setPins(personId: string, pins: Record<string, string>): Promise<void>;
  /** Tarefa sem tracker (criada no Echo): não há o que o outbox escrever. */
  assignLocalTask(taskId: string, toId: string): Promise<void>;
  hasSlack(personId: string): Promise<boolean>;
}

export interface WorkPlanningDeps {
  data: (orgId: string) => AgentData;
  store: (orgId: string) => WorkPlanningStore;
  outbox: (orgId: string) => { enqueue(action: OutboxAction): Promise<{ id: string; duplicate: boolean }> };
  recorder: RunRecorder;
  clock?: Clock;
  webUrl: string;
}

export interface BoardPerson {
  id: string;
  name: string;
  role: Person["role"];
  away: boolean;
  /** Pontos já na agenda dos próximos dias e quanto cabe neles. */
  points: number;
  capacity: number;
  /** Primeiro dia com espaço. */
  nextFree?: string | undefined;
  today: { key: string; title: string }[];
  waiting: number;
}

export interface BoardTask {
  key: string;
  title: string;
  size?: number | undefined;
  dueDate?: string | undefined;
  blockedBy: { key: string; owner?: string | undefined }[];
  /** Pessoa → dia em que a tarefa entraria na agenda dela; null quando ficaria esperando ou não cabe. */
  starts: Record<string, string | null>;
}

export interface WorkBoard {
  today: string;
  people: BoardPerson[];
  tasks: BoardTask[];
}

export type AssignOutcome = { status: "queued"; message: string } | { status: "denied" | "not_found" | "refused"; reason: string };
export type MoveOutcome = { status: "moved" } | { status: "denied" | "not_found" | "refused"; reason: string };

const MAX_BOARD_TASKS = 30;
const first = (p: Pick<Person, "name">) => p.name.trim().split(/\s+/)[0] ?? p.name;
const ASSIGNABLE: ReadonlySet<Task["state"]> = new Set(["backlog", "todo"]);

/** Dia em que a tarefa entra na agenda da pessoa, e o motivo. */
function startOf(schedule: PersonSchedule, key: string) {
  for (const day of schedule.days) {
    const entry = day.entries.find((e) => e.key === key);
    if (entry) return { date: day.date, reason: entry.reason };
  }
  return null;
}

/** Aviso a quem recebe a tarefa: o que é, quem passou e quando o agente sugere começar. */
export function assignedMessage(input: { task: Task; leader: Person; target: Person; schedule: PersonSchedule; today: string; webUrl: string }): { text: string; blocks: unknown[] } {
  const { task, leader, target, schedule, today } = input;
  const start = startOf(schedule, task.key);
  const waiting = schedule.waiting.find((w) => w.key === task.key);
  const when = start ? `${scheduleDayLabel(start.date, today)}, ${dayMonth(start.date)}` : waiting ? "Depois da entrega de que depende" : "Depois dos próximos dias";
  const why = start?.reason ?? (waiting ? `espera ${waiting.waitingOn.map((w) => (w.owner ? `${w.key} de ${w.owner}` : w.key)).join(", ")}` : "a agenda dos próximos dias está cheia");
  const text = `${first(leader)} passou ${task.key} para você: ${task.title}. Início sugerido: ${when} (${why}). Você pode mudar o dia em Meu plano.`;
  return {
    text,
    blocks: [
      header(`Nova tarefa: ${task.key}`),
      statusTag(DOT.agent, "NA SUA AGENDA", `Agente de ${esc(first(target))}`),
      section(`*${esc(task.title)}*\nDistribuída por ${esc(first(leader))}.`),
      columns(`*Início sugerido*\n${esc(when)}`, `*Prazo*\n${task.dueDate ? `\`${dayMonth(task.dueDate)}\`` : "Sem prazo"}`),
      context(`${esc(why.charAt(0).toUpperCase() + why.slice(1))}. Você pode mudar o dia em Meu plano.`),
      actions(linkButton("abrir_plano", "Abrir Meu plano", `${input.webUrl.replace(/\/$/, "")}/plano`, true)),
    ],
  };
}

export function createWorkPlanning(deps: WorkPlanningDeps) {
  const clock = deps.clock ?? systemClock;
  const record = (run: AgentRun) => deps.recorder.record(run).catch(() => undefined);

  async function load(orgId: string) {
    const data = deps.data(orgId);
    const [people, tasks, absences] = await Promise.all([data.people(), data.tasks({ openOnly: true }), data.absences()]);
    return { people, tasks, absences };
  }

  /** Agenda da pessoa agora, com os dias que ela mesma escolheu. */
  async function schedule(orgId: string, personId: string): Promise<{ today: string; schedule: PersonSchedule } | null> {
    const { people, tasks, absences } = await load(orgId);
    const person = people.find((p) => p.id === personId);
    if (!person || !person.active || person.role === "hr") return null;
    const now = clock.now();
    return { today: localDate(now, person.timezone), schedule: personSchedule({ person, people, tasks, absences, now, pins: await deps.store(orgId).pins(personId) }) };
  }

  /** Mesa da liderança: quem está com quanto e o que falta distribuir. Só a própria equipe. */
  async function board(orgId: string, leaderId: string): Promise<WorkBoard | null> {
    const { people, tasks, absences } = await load(orgId);
    const leader = people.find((p) => p.id === leaderId);
    if (!leader || leader.role !== "leader") return null;
    const now = clock.now();
    const store = deps.store(orgId);
    const team = people.filter((p) => p.active && p.role !== "hr" && (!leader.teamId || p.teamId === leader.teamId));
    const pins = new Map(await Promise.all(team.map(async (p) => [p.id, await store.pins(p.id)] as const)));
    const plan = (p: Person, list: Task[]) => personSchedule({ person: p, people, tasks: list, absences, now, pins: pins.get(p.id) ?? {} });
    const nameOf = (id: string | undefined) => people.find((p) => p.id === id);
    const free = tasks
      .filter((t) => !t.assigneeId && ASSIGNABLE.has(t.state))
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.key.localeCompare(b.key))
      .slice(0, MAX_BOARD_TASKS);
    const open = new Set(tasks.map((t) => t.key));
    return {
      today: localDate(now, leader.timezone),
      people: team.map((p) => {
        const s = plan(p, tasks);
        return {
          id: p.id,
          name: p.name,
          role: p.role,
          away: absences.some((a) => a.personId === p.id && a.startsAt <= now && a.endsAt > now),
          points: s.days.reduce((n, d) => n + d.points, 0),
          capacity: s.days.length * SCHEDULE_RULES.pointsPerDay,
          nextFree: s.days.find((d) => d.points < SCHEDULE_RULES.pointsPerDay)?.date,
          // Em ausência, o primeiro dia da agenda é o da volta: não é "hoje".
          today: (s.days.find((d) => d.date === localDate(now, p.timezone))?.entries ?? []).map((e) => ({ key: e.key, title: e.title })),
          waiting: s.waiting.length,
        };
      }),
      tasks: free.map((t) => ({
        key: t.key,
        title: t.title,
        size: t.size,
        dueDate: t.dueDate,
        blockedBy: (t.blockedBy ?? []).filter((k) => open.has(k)).map((k) => {
          const owner = nameOf(tasks.find((o) => o.key === k)?.assigneeId);
          return { key: k, owner: owner ? first(owner) : undefined };
        }),
        starts: Object.fromEntries(team.map((p) => [p.id, startOf(plan(p, tasks.map((o) => (o.key === t.key ? { ...o, assigneeId: p.id } : o))), t.key)?.date ?? null])),
      })),
    };
  }

  /** A liderança atribui. A escrita no tracker sai pelo outbox, com a aprovação dela; a pessoa recebe o aviso com o dia sugerido. */
  async function assign(orgId: string, leaderId: string, taskKey: string, toId: string): Promise<AssignOutcome> {
    const started = performance.now();
    const done = async (o: AssignOutcome, tools: string[] = []) => {
      await record({ flow: "task_assign", orgId, durationMs: Math.round(performance.now() - started), result: o.status === "queued" ? "ok" : o.status === "refused" ? "skipped" : "refused", tools, ...(o.status === "queued" ? {} : { error: o.reason }) });
      return o;
    };
    try {
      const { people, tasks, absences } = await load(orgId);
      const leader = people.find((p) => p.id === leaderId);
      const target = people.find((p) => p.id === toId);
      const task = tasks.find((t) => t.key === taskKey);
      if (!leader || leader.role !== "leader") return done({ status: "denied", reason: "Só a liderança distribui tarefas." });
      if (!target || !task) return done({ status: "not_found", reason: "Tarefa ou pessoa não encontrada." });
      const now = clock.now();
      const check = assignCheck({ leader, target, task, absences, now });
      if (!check.ok) return done({ status: "refused", reason: check.reason });

      const outbox = deps.outbox(orgId);
      const store = deps.store(orgId);
      const minute = Math.floor(now.getTime() / 60_000);
      const key = `task_assign:${task.id}:${toId}:${minute}`;
      const tools: string[] = [];
      if (task.hasLinearId) {
        await outbox.enqueue({ type: "linear.assign", target: `linear:${task.key}`, payload: { taskKey: task.key, toPersonId: toId }, idempotencyKey: `${key}:assign`, approvedBy: leader.id });
        tools.push("linear.assign");
      } else {
        await store.assignLocalTask(task.id, toId);
      }
      const today = localDate(now, target.timezone);
      const view = personSchedule({ person: target, people, tasks: tasks.map((t) => (t.key === task.key ? { ...t, assigneeId: toId } : t)), absences, now, pins: await store.pins(toId) });
      if (await store.hasSlack(toId)) {
        const msg = assignedMessage({ task, leader, target, schedule: view, today, webUrl: deps.webUrl });
        await outbox.enqueue({ type: "slack.dm", target: `person:${toId}`, payload: { personId: toId, text: msg.text, blocks: msg.blocks }, idempotencyKey: `${key}:dm` });
        tools.push("slack.dm");
      }
      const start = startOf(view, task.key);
      const when = start ? `${scheduleDayLabel(start.date, today).toLowerCase()}, ${dayMonth(start.date)}` : "depois da entrega de que depende ou dos próximos dias";
      return done({ status: "queued", message: `${task.key} vai para ${first(target)}. Início sugerido: ${when}.${task.hasLinearId ? " A mudança está na fila para o tracker." : ""}` }, tools);
    } catch (err) {
      await record({ flow: "task_assign", orgId, durationMs: Math.round(performance.now() - started), result: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** A própria pessoa escolhe o dia da tarefa, ou volta à sugestão (`date` null). */
  async function move(orgId: string, byPersonId: string, personId: string, taskKey: string, date: string | null): Promise<MoveOutcome> {
    const started = performance.now();
    const done = async (o: MoveOutcome) => {
      await record({ flow: "schedule_move", orgId, durationMs: Math.round(performance.now() - started), result: o.status === "moved" ? "ok" : "refused", ...(o.status === "moved" ? {} : { error: o.reason }) });
      return o;
    };
    if (byPersonId !== personId) return done({ status: "denied", reason: "Só a própria pessoa muda a agenda dela." });
    const { people, tasks, absences } = await load(orgId);
    const person = people.find((p) => p.id === personId);
    if (!person || !tasks.some((t) => t.key === taskKey && t.assigneeId === personId)) return done({ status: "not_found", reason: "Esta tarefa não está na sua agenda." });
    if (date !== null && !validPin(date, person, absences, clock.now())) return done({ status: "refused", reason: "Escolha um dos próximos dias de trabalho." });
    const store = deps.store(orgId);
    const { [taskKey]: _old, ...rest } = await store.pins(personId);
    await store.setPins(personId, date === null ? rest : { ...rest, [taskKey]: date });
    return done({ status: "moved" });
  }

  return { schedule, board, assign, move };
}

export type WorkPlanning = ReturnType<typeof createWorkPlanning>;
