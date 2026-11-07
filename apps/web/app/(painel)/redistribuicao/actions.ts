"use server";

import { revalidatePath } from "next/cache";
import { saveDecision, stamp, type DecisionId } from "@/lib/decisions-store";
import { currentPersona } from "@/lib/session";

/** Só a liderança aprova; desfazer devolve as tarefas a quem estava antes. */
export async function decidir(id: DecisionId, aprovar: boolean): Promise<{ ok: boolean; at?: string }> {
  const me = await currentPersona();
  if (!me || me.role !== "leader") return { ok: false };
  const at = stamp(new Date(), me.timezone);
  await saveDecision(id, aprovar ? { by: me.name, at } : null);
  revalidatePath("/", "layout");
  return { ok: true, at };
}
