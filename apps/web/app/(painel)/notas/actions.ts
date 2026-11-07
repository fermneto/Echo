"use server";

import { revalidatePath } from "next/cache";
import { canAskTwin } from "@/lib/access";
import { panelDb } from "@/lib/db";
import { findNote, MAX_NOTE, notesWith } from "@/lib/demo/notes";
import { correctNote } from "@/lib/notes-db";
import { saveNoteEdit } from "@/lib/notes-store";
import { currentPersona } from "@/lib/session";

export type EditState = { error?: string; saved?: number };

/** Corrigir uma nota grava uma versão nova; a anterior continua no histórico. */
export async function editarNota(_prev: EditState, formData: FormData): Promise<EditState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { error: "Você não tem permissão para editar notas." };
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("texto") ?? "").trim();
  if (!body) return { error: "A nota não pode ficar vazia." };

  const db = panelDb();
  if (db) {
    const r = await correctNote(db, me, id, body);
    if (!r.ok) return { error: r.error };
    revalidatePath("/notas");
    return { saved: Date.now() };
  }

  const note = findNote(notesWith({}), id);
  if (!note) return { error: "Nota não encontrada." };
  if (note.ownerId !== me.id) return { error: "Só a dona da nota pode corrigi-la." };
  await saveNoteEdit(id, body.slice(0, MAX_NOTE), me.name, "06/11");
  revalidatePath("/", "layout");
  return { saved: Date.now() };
}
