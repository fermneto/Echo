"use server";

import { canSee } from "@/lib/access";
import { type NoteView, sectionsFromForm } from "@/lib/daily-note";
import { confirmNote, draftNote } from "@/lib/daily-note-store";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentPersona, demoMode } from "@/lib/session";

export type ConfirmState = { view?: NoteView; error?: string; saved?: number };

/** Confirmar a nota do dia: só a própria pessoa, com as edições dela. Vale o mesmo fluxo do botão do Slack. */
export async function confirmarNota(_prev: ConfirmState, formData: FormData): Promise<ConfirmState> {
  const me = await currentPersona();
  if (!me || !canSee(me.role, "notaDoDia", { demo: demoMode() })) return { error: "Você não tem permissão para confirmar esta nota." };
  const date = String(formData.get("data") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Data da nota inválida." };
  const sections = sectionsFromForm(formData);
  if (sections.stoppedAt.length === 0) return { error: "Escreva onde você parou." };
  try {
    const r = await confirmNote(me, date, sections);
    return r.ok ? { view: r.view, saved: Date.now() } : { error: r.error };
  } catch (err) {
    console.error("confirmação da nota do dia falhou", err instanceof Error ? err.message : String(err));
    return { error: "Não foi possível confirmar agora. Tente de novo em instantes." };
  }
}

/** Gerar o rascunho de hoje agora, sem esperar o fim do expediente. */
export async function gerarRascunho(): Promise<void> {
  const me = await currentPersona();
  if (!me || !canSee(me.role, "notaDoDia", { demo: demoMode() })) return;
  const r = await draftNote(me);
  revalidatePath("/nota-do-dia");
  if (!r.ok && r.reason) redirect(`/nota-do-dia?sem=${encodeURIComponent(r.reason)}`);
}
