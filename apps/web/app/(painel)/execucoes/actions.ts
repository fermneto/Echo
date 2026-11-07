"use server";

import { revalidatePath } from "next/cache";
import { resetDecisions } from "@/lib/decisions-store";
import { resetNotes } from "@/lib/notes-store";
import { currentPersona } from "@/lib/session";

/** Recriar a demonstração: desfaz as edições e decisões deste visitante (o seed faz o mesmo no banco). */
export async function recriarDemo(): Promise<void> {
  const me = await currentPersona();
  if (!me || me.role !== "leader") return;
  await resetNotes();
  await resetDecisions();
  revalidatePath("/", "layout");
}
