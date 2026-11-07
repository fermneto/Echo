import { cookies } from "next/headers";
import { loadConfig } from "@echo/config";
import { localDate, noteStateAt } from "@echo/domain";
import { personIdFor } from "./agent";
import { DAILY_NOTE_COOKIE, demoDraft, demoNoteView, type NoteSections, type NoteView, parseDemoNotes, patchFromSections, sectionsFromNote } from "./daily-note";
import { panelDb } from "./db";
import { findMember } from "./demo/team";
import { profileFor } from "./demo/profiles";
import type { Persona } from "./demo/types";
import { gainsOrgId } from "./gains";

/**
 * Nota do dia da própria pessoa. Com banco, o fluxo real do fim do expediente (packages/agents → createEndOfDay):
 * lê a nota de hoje; o rascunho só é pedido ao agente por uma ação explícita (draftNote), nunca ao abrir a tela,
 * porque pedir o rascunho grava e avisa no Slack. Sem banco, rascunho da demo com a confirmação
 * guardada no cookie deste visitante.
 */

export type NoteRead = { view: NoteView | null; mode: "db" | "demo"; reason?: string; canDraft?: boolean };
export type ConfirmResult = { ok: true; view: NoteView } | { ok: false; error: string };

async function serverFlow() {
  const db = panelDb();
  if (!db) return null;
  // Import tardio: o servidor dos agentes (e o SDK da Anthropic) só carrega nesta tela.
  const { serverEndOfDay, createPgDailyNoteStore, createPgAgentData } = await import("@echo/agents/server");
  const c = loadConfig("web");
  return { db, flow: serverEndOfDay(db, c.ANTHROPIC_API_KEY, c.PANEL_URL ?? "http://localhost:3000"), store: (org: string) => createPgDailyNoteStore(db, org), data: (org: string) => createPgAgentData(db, org) };
}

export async function readNote(me: Persona, now: Date = new Date()): Promise<NoteRead> {
  const today = localDate(now, me.timezone);
  const s = await serverFlow();
  if (!s) {
    const saved = parseDemoNotes((await cookies()).get(DAILY_NOTE_COOKIE)?.value)[me.id];
    return { view: demoNoteView(saved, today, demoDraft(profileFor(findMember(me.id) ?? me))), mode: "demo" };
  }

  const orgId = gainsOrgId(me.orgId);
  const personId = personIdFor(me.id);
  const store = s.store(orgId);
  const data = s.data(orgId);
  let note = await store.get(personId, today);
  const reason: string | undefined = undefined;
  const canDraft = !note;
  let previous = false;
  if (!note) {
    // Sem atividade hoje, a nota anterior continua valendo para quem pergunta.
    const last = await data.latestDailyNote(personId);
    note = last ? await store.get(personId, last.date) : null;
    previous = !!note;
  }
  if (!note) return { view: null, mode: "db", canDraft, ...(reason ? { reason } : {}) };
  const people = await data.people();
  return {
    view: { date: note.date, state: noteStateAt(note, now), sections: sectionsFromNote(note, people), ...(previous ? { previous } : {}) },
    mode: "db",
    canDraft,
    ...(reason ? { reason } : {}),
  };
}

/** Pede ao agente o rascunho de hoje (o mesmo do fim do expediente; idempotente por pessoa e data). */
export async function draftNote(me: Persona, now: Date = new Date()): Promise<{ ok: boolean; reason?: string }> {
  const s = await serverFlow();
  if (!s) return { ok: false };
  const r = await s.flow.draft(gainsOrgId(me.orgId), personIdFor(me.id), localDate(now, me.timezone));
  return r.status === "skipped" ? { ok: false, reason: r.reason } : { ok: true };
}

const DENIED: Record<string, string> = {
  not_found: "Nota não encontrada.",
  denied: "Só a própria pessoa confirma a nota.",
  already: "A nota mudou antes da confirmação. Recarregue a página.",
};

export async function confirmNote(me: Persona, date: string, sections: NoteSections, now: Date = new Date()): Promise<ConfirmResult> {
  const s = await serverFlow();
  if (!s) {
    const today = localDate(now, me.timezone);
    if (date !== today) return { ok: false, error: "Esta nota não é de hoje. Recarregue a página." };
    const jar = await cookies();
    const all = parseDemoNotes(jar.get(DAILY_NOTE_COOKIE)?.value);
    all[me.id] = { date, sections, confirmed: true };
    jar.set(DAILY_NOTE_COOKIE, JSON.stringify(all), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    return { ok: true, view: { date, state: "confirmed", sections } };
  }

  const orgId = gainsOrgId(me.orgId);
  const personId = personIdFor(me.id);
  const stored = await s.store(orgId).get(personId, date);
  if (!stored) return { ok: false, error: DENIED.not_found! };
  const people = await s.data(orgId).people();
  const r = await s.flow.confirm(orgId, personId, personId, date, patchFromSections(sections, people, stored));
  if (r.status !== "confirmed") return { ok: false, error: DENIED[r.status] ?? r.reason };
  return { ok: true, view: { date, state: "confirmed", sections: sectionsFromNote(r.note, people) } };
}
