// Leituras do painel para quem é de uma empresa conectada (login pelo Slack): equipes, o trabalho aberto de uma
// pessoa, o que espera por ela e o plano da manhã gravado. Só leitura, sempre dentro da empresa (withOrg).
// As regras de quem espera por quem são as do plano da manhã (packages/domain → morningPlan).
import { type Database, teams, withOrg } from "@echo/db";
import { DAY, type DailyNote, localDate, morningPlan, noteAwaitingConfirmation, type PlanItem, type PullRequest, type Task } from "@echo/domain";
import { eq } from "drizzle-orm";
import { createPgAgentData } from "./pg-data.ts";
import { createPgPlanStore } from "./pg-night.ts";
import { createPgDailyNoteStore } from "./pg-notes.ts";

export interface PanelTeam {
  id: string;
  name: string;
  leaderId?: string;
}

/** Equipes da empresa, por nome. */
export async function readTeams(db: Database, orgId: string): Promise<PanelTeam[]> {
  const rows = await withOrg(db, orgId, (tx) => tx.select({ id: teams.id, name: teams.name, leaderId: teams.leaderId }).from(teams).where(eq(teams.orgId, orgId)));
  return rows.map((r) => ({ id: r.id, name: r.name, ...(r.leaderId ? { leaderId: r.leaderId } : {}) })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export interface PersonWork {
  /** Tarefas abertas atribuídas à pessoa. */
  tasks: Task[];
  /** PRs abertos de autoria da pessoa. */
  pullRequests: PullRequest[];
  /** PRs abertos de outras pessoas com revisão pedida a ela. */
  reviews: PullRequest[];
  /** Última nota do dia que vale para quem pergunta (confirmada ou enviada sem revisão). */
  note: DailyNote | null;
}

/** O que a pessoa tem aberto no Linear e no GitHub, e a última nota do dia. Sem contagem nem tempo online. */
export async function readPersonWork(db: Database, orgId: string, personId: string): Promise<PersonWork> {
  const data = createPgAgentData(db, orgId);
  const [tasks, prs, note] = await Promise.all([data.tasks({ assigneeId: personId, openOnly: true }), data.pullRequests({ openOnly: true }), data.latestDailyNote(personId)]);
  return {
    tasks,
    pullRequests: prs.filter((p) => p.authorId === personId),
    reviews: prs.filter((p) => p.state === "open" && p.authorId !== personId && p.reviewerIds.includes(personId)),
    note,
  };
}

export type WaitingKind = "fix_ready" | "question" | "review_request" | "daily_note";

export interface WaitingItem {
  id: string;
  kind: WaitingKind;
  text: string;
  /** Motivo, escrito por regra. */
  reason: string;
  ref: string;
}

const WAITING_KINDS: ReadonlySet<PlanItem["kind"]> = new Set(["fix_ready", "question", "review_request"]);
const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

/**
 * O que está parado esperando a pessoa: correção pronta para decidir, perguntas que precisam dela, revisões
 * pedidas (as mesmas regras do plano da manhã) e a nota do dia a confirmar. Os planos de ausência da liderança
 * vêm de `awaitingPlansFor`. O RH não tem pendências de trabalho.
 */
export async function readWaiting(db: Database, orgId: string, personId: string, now: Date): Promise<WaitingItem[]> {
  const data = createPgAgentData(db, orgId);
  const plans = createPgPlanStore(db, orgId);
  const notes = createPgDailyNoteStore(db, orgId);
  const people = await data.people();
  const person = people.find((p) => p.id === personId);
  if (!person || !person.active || person.role === "hr") return [];
  const today = localDate(now, person.timezone);
  const [questions, fixes, prs, todayNote, lastNote] = await Promise.all([
    plans.questionsForOwner(personId, new Date(now.getTime() - 7 * DAY)),
    plans.fixesForAuthor(personId),
    data.pullRequests({ openOnly: true }),
    notes.get(personId, today),
    data.latestDailyNote(personId),
  ]);
  const { all } = morningPlan({ person, people, now, questions, pullRequests: prs, tasks: [], findings: [], fixes });
  const items: WaitingItem[] = all.filter((i) => WAITING_KINDS.has(i.kind)).map((i) => ({ id: i.id, kind: i.kind as WaitingKind, text: i.text, reason: i.reason, ref: i.ref }));

  const stored = todayNote ?? (lastNote ? await notes.get(personId, lastNote.date) : null);
  const note = noteAwaitingConfirmation(stored, now, today);
  if (note) {
    items.push({
      id: `note:${note.date}`,
      kind: "daily_note",
      text: `Nota do dia de ${dayMonth(note.date)} esperando a sua confirmação`,
      reason: note.state === "draft" ? "rascunho do seu agente; quem pergunta vê o aviso de nota não confirmada" : "foi enviada sem revisão; confirme ou corrija",
      ref: `note:${note.date}`,
    });
  }
  return items;
}

/** Plano da manhã gravado para a pessoa na data (AAAA-MM-DD do fuso dela). Sem plano, null: nada é inventado. */
export async function readMorningPlan(db: Database, orgId: string, personId: string, date: string): Promise<PlanItem[] | null> {
  return (await createPgPlanStore(db, orgId).get(personId, date))?.items ?? null;
}
