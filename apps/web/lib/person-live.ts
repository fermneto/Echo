import type { PersonWork } from "@echo/agents/painel";
import type { PullRequest, Task } from "@echo/domain";
import { canAskTwin } from "./access";
import { dayMonth, type NamedPerson, sectionsFromNote } from "./daily-note";
import { panelDb } from "./db";
import { latest } from "./demo/notes";
import { profileFor, type Profile } from "./demo/profiles";
import { suggestedQuestions } from "./demo/twin";
import type { Persona } from "./demo/types";
import { gainsOrgId, isDemoOrg } from "./gains";
import { currentNotes } from "./notes-store";
import { loadNotes } from "./notes-db";

/**
 * Ficha da pessoa. Persona da demonstração: perfil, notas e perguntas sintéticos (lib/demo). Empresa conectada:
 * tarefas e PRs abertos, a última nota do dia e as notas do cérebro, lidos do banco da empresa (withOrg); o que
 * faltar fica vazio, nunca com dado da demonstração.
 */

export type ProfileView = { profile: Profile; notes: { title: string; excerpt: string; tags: string[] }[]; suggestions: string[] };

const TASK_STATE: Record<string, string> = { backlog: "No backlog", todo: "A fazer", in_progress: "Em andamento", in_review: "Em revisão" };
const CHECKS: Record<string, string> = { success: "testes passando", failure: "testes falhando", pending: "testes rodando" };
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

function taskLine(t: Task) {
  const meta = [TASK_STATE[t.state] ?? "Aberta", ...(t.dueDate ? [`prazo ${dayMonth(t.dueDate)}`] : [])].join(" · ");
  return { title: `${t.key} · ${t.title}`, meta };
}

function prLine(pr: PullRequest) {
  const meta = [pr.state === "draft" ? "Rascunho" : "Aberto", pr.branch, ...(pr.checksState ? [CHECKS[pr.checksState]!] : [])].join(" · ");
  return { title: `PR ${pr.number} · ${pr.title}`, meta };
}

function reviewLine(pr: PullRequest, people: readonly NamedPerson[]) {
  const author = people.find((p) => p.id === pr.authorId);
  return { title: `Revisão do PR ${pr.number}${author ? `, de ${firstName(author.name)}` : ""}`, meta: `Revisão pedida · ${pr.title}` };
}

/** O trabalho aberto e a última nota no formato da ficha. Pura. `base` é o perfil do banco (habilidades, idiomas). */
export function profileFromWork(base: Profile, work: PersonWork, people: readonly NamedPerson[]): Profile {
  const s = work.note ? sectionsFromNote(work.note, people) : null;
  return {
    ...base,
    work: [...work.tasks.map(taskLine), ...work.pullRequests.map(prLine), ...work.reviews.map((pr) => reviewLine(pr, people))],
    ...(work.note && s ? { lastNote: { date: dayMonth(work.note.date), stoppedAt: s.stoppedAt.join(" "), blocked: s.blocked, released: s.released, reserved: s.reserved } } : {}),
  };
}

/** Perguntas sugeridas tiradas das tarefas e PRs reais da pessoa (no máximo 4). Pura. */
export function questionsFromWork(name: string, work: PersonWork): string[] {
  const who = firstName(name);
  const task = work.tasks.find((t) => t.state === "in_progress") ?? work.tasks[0];
  const pr = work.pullRequests[0];
  const review = work.reviews[0];
  const out = [
    ...(work.note ? [`Onde ${who} parou?`] : []),
    ...(task ? [`Em que pé está a ${task.key}?`] : []),
    ...(pr ? [`Posso mexer na branch ${pr.branch}?`] : []),
    ...(review ? [`${who} já revisou o PR ${review.number}?`] : []),
  ];
  return out.length > 0 ? out.slice(0, 4) : [`Quando ${who} volta?`];
}

type Deps = { read?: (orgId: string, personId: string) => Promise<PersonWork>; notes?: (me: Persona) => Promise<{ ownerId: string | null; notes: { title: string; tags: string[]; versions: { n: number; body: string; by: string; at: string }[] }[] }[]> };

/** Perfil, notas e perguntas da ficha, para quem está vendo. O RH não lê trabalho nem notas. */
export async function loadProfile(me: Persona, persona: Persona, team: readonly NamedPerson[], deps: Deps = {}): Promise<ProfileView> {
  const base = profileFor(persona);
  if (isDemoOrg(me.orgId)) {
    const brain = (await currentNotes()).filter((n) => n.ownerId === persona.id);
    const notes = brain.length ? brain.map((n) => ({ title: n.title, excerpt: latest(n).body, tags: n.tags })) : base.notes;
    return { profile: base, notes, suggestions: suggestedQuestions(persona) };
  }
  const empty: ProfileView = { profile: base, notes: [], suggestions: [] };
  if (!canAskTwin(me.role)) return empty;
  const db = deps.read && deps.notes ? null : panelDb();
  if (!deps.read && !db) return empty;
  try {
    const orgId = gainsOrgId(me.orgId);
    const read = deps.read ?? (async (o: string, p: string) => (await import("@echo/agents/painel")).readPersonWork(db!, o, p));
    const readNotes = deps.notes ?? ((viewer: Persona) => loadNotes(db!, viewer));
    const [work, groups] = await Promise.all([read(orgId, persona.id), readNotes(me)]);
    const mine = groups.find((g) => g.ownerId === persona.id)?.notes ?? [];
    return {
      profile: profileFromWork(base, work, team),
      notes: mine.map((n) => ({ title: n.title, excerpt: latest(n).body, tags: n.tags })),
      suggestions: questionsFromWork(persona.name, work),
    };
  } catch (err) {
    console.error("ficha da pessoa não foi lida do banco", err instanceof Error ? err.message : String(err));
    return empty;
  }
}
