"use server";

import { revalidatePath } from "next/cache";
import { panelIds } from "@/lib/redistribution-server";
import { currentPersona } from "@/lib/session";
import { workPlanningFlow } from "@/lib/work-planning";

export type AssignResult = { ok: true; message: string } | { ok: false; error: string };

/** A liderança passa a tarefa. A permissão é conferida de novo no fluxo; o tracker só muda pelo outbox. */
export async function atribuirTarefa(taskKey: string, personId: string): Promise<AssignResult> {
  const me = await currentPersona();
  const flow = me?.role === "leader" ? await workPlanningFlow() : null;
  if (!me || !flow) return { ok: false, error: "Só a liderança da equipe distribui tarefas." };
  try {
    const r = await flow.assign(panelIds(me).orgId, panelIds(me).personId, taskKey, personId);
    revalidatePath("/distribuir");
    revalidatePath("/plano");
    return r.status === "queued" ? { ok: true, message: r.message } : { ok: false, error: r.reason };
  } catch (err) {
    console.error("tarefa não foi atribuída", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Não deu para concluir agora. Tente de novo em instantes." };
  }
}
