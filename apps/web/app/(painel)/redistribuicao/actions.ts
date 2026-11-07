"use server";

import { revalidatePath } from "next/cache";
import { saveDecision, stamp, type DecisionId } from "@/lib/decisions-store";
import { absenceKind } from "@/lib/redistribution";
import { panelIds, redistributionFlow } from "@/lib/redistribution-server";
import { currentPersona } from "@/lib/session";

/** Só a liderança aprova; desfazer devolve as tarefas a quem estava antes. Demonstração sem banco. */
export async function decidir(id: DecisionId, aprovar: boolean): Promise<{ ok: boolean; at?: string }> {
  const me = await currentPersona();
  if (!me || me.role !== "leader") return { ok: false };
  const at = stamp(new Date(), me.timezone);
  await saveDecision(id, aprovar ? { by: me.name, at } : null);
  revalidatePath("/", "layout");
  return { ok: true, at };
}

export type FlowResult = { ok: true; message?: string } | { ok: false; error: string };

const DENIED: FlowResult = { ok: false, error: "Só a liderança da equipe decide este plano." };

/** Falha do banco ou do fluxo vira mensagem na tela, nunca um estado inventado. */
async function guarded(fn: () => Promise<FlowResult>): Promise<FlowResult> {
  try {
    return await fn();
  } catch (err) {
    console.error("redistribuição falhou", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "Não deu para concluir agora. Tente de novo em instantes." };
  }
}

async function leader() {
  const me = await currentPersona();
  const flow = me?.role === "leader" ? await redistributionFlow() : null;
  return me && flow ? { me, flow, ...panelIds(me) } : null;
}

/**
 * Registra a ausência e monta o plano na hora: o plano sai de regras fixas, sem modelo, e é um por ausência
 * (se o worker também receber o aviso, ele não cria outro). Nada muda nas tarefas até a aprovação.
 */
export async function registrarAusencia(input: { personId: string; kind: string; startDate: string; endDate: string }): Promise<FlowResult> {
  return guarded(async () => {
    const ctx = await leader();
    if (!ctx) return DENIED;
    const kind = absenceKind(input.kind);
    if (!kind) return { ok: false, error: "Escolha o tipo da ausência." };
    const r = await ctx.flow.registerAbsence(ctx.orgId, ctx.personId, { personId: input.personId, startDate: input.startDate, endDate: input.endDate, kind });
    if (r.status !== "registered") return { ok: false, error: r.status === "denied" ? "Você não pode registrar a ausência desta pessoa." : "Confira as datas: o fim não pode ser antes do início." };
    const plan = await ctx.flow.propose(ctx.orgId, r.absenceId);
    revalidatePath("/", "layout");
    if (plan.status === "skipped") return { ok: true, message: plan.reason === "nada a redistribuir" ? "Ausência registrada. Não há tarefas abertas nem revisões para passar adiante." : "Ausência registrada. Ela já tinha um plano." };
    return { ok: true };
  });
}

/** Aprova o plano, com os itens deixados de fora. As mudanças entram no outbox com a aprovação registrada. */
export async function aprovarPlano(planId: string, exclude: string[], adjust: { itemId: string; toId: string }[] = []): Promise<FlowResult> {
  return guarded(async () => {
    const ctx = await leader();
    if (!ctx) return DENIED;
    const r = await ctx.flow.approve(ctx.orgId, ctx.personId, planId, { ...(exclude.length ? { exclude } : {}), ...(adjust.length ? { adjust } : {}) });
    revalidatePath("/", "layout");
    if (r.status === "ok") return { ok: true, ...(r.warnings.length ? { message: r.warnings.join(". ") } : {}) };
    if (r.status === "denied") return DENIED;
    if (r.status === "conflict") return { ok: false, error: "Este plano já foi decidido." };
    if (r.status === "invalid") return { ok: false, error: r.reason };
    return { ok: false, error: "Plano não encontrado." };
  });
}

/** Descarta o plano: nada muda nas tarefas. */
export async function descartarPlano(planId: string): Promise<FlowResult> {
  return guarded(async () => {
    const ctx = await leader();
    if (!ctx) return DENIED;
    const r = await ctx.flow.reject(ctx.orgId, ctx.personId, planId);
    revalidatePath("/", "layout");
    if (r.status === "ok") return { ok: true };
    if (r.status === "conflict") return { ok: false, error: "Este plano já foi decidido." };
    return r.status === "denied" ? DENIED : { ok: false, error: "Plano não encontrado." };
  });
}

/**
 * Passa adiante um item recusado, que falhou ou ficou sem responsável, depois da aprovação.
 * As regras de quem pode receber (ausência, conta no Linear, autor do PR) ficam no fluxo.
 */
export async function repassarItem(itemId: string, toId: string): Promise<FlowResult> {
  return guarded(async () => {
    const ctx = await leader();
    if (!ctx) return DENIED;
    const r = await ctx.flow.reassign(ctx.orgId, ctx.personId, itemId, toId);
    revalidatePath("/", "layout");
    if (r.status === "ok") return { ok: true, ...(r.warnings.length ? { message: r.warnings.join(". ") } : {}) };
    if (r.status === "denied") return DENIED;
    if (r.status === "conflict") return { ok: false, error: "Este item mudou antes da troca. Recarregue a página." };
    if (r.status === "invalid") return { ok: false, error: `Não dá para passar a essa pessoa: ${r.reason}.` };
    return { ok: false, error: "Item não encontrado." };
  });
}
