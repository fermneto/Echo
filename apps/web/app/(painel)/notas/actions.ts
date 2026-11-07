"use server";

import { revalidatePath } from "next/cache";
import { canAskTwin } from "@/lib/access";
import { findNote, MAX_NOTE, notesWith } from "@/lib/demo/notes";
import { saveNoteEdit } from "@/lib/notes-store";
import { currentPersona } from "@/lib/session";

export type EditState = { error?: string; saved?: number };

/** Corrigir uma nota grava uma versão nova; a anterior continua no histórico. */
export async function editarNota(_prev: EditState, formData: FormData): Promise<EditState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { error: "Você não tem permissão para editar notas." };
  const id = String(formData.get("id") ?? "");
  const note = findNote(notesWith({}), id);
  if (!note) return { error: "Nota não encontrada." };
  if (note.ownerId !== me.id) return { error: "Só a dona da nota pode corrigi-la." };
  const body = String(formData.get("texto") ?? "").trim().slice(0, MAX_NOTE);
  if (!body) return { error: "A nota não pode ficar vazia." };
  await saveNoteEdit(id, body, me.name, "06/11");
  revalidatePath("/", "layout");
  return { saved: Date.now() };
}
