"use server";

import { revalidatePath } from "next/cache";
import { REPORT_RULES } from "@echo/domain";
import { panelDb } from "@/lib/db";
import { helpRef } from "@/lib/reports";
import { reportContext, reportFlow } from "@/lib/reports-db";
import { currentPersona } from "@/lib/session";

export type ObsState = { error?: string; saved?: number };
export type HelpState = { error?: string; done?: string };

/** Observação da própria pessoa: entra literal, marcada como informada por ela, sem mudar número nenhum. */
export async function salvarObservacao(_prev: ObsState, formData: FormData): Promise<ObsState> {
  const me = await currentPersona();
  const db = panelDb();
  if (!me || !db || me.role === "hr") return { error: "Você não pode comentar este relatório." };
  const text = String(formData.get("texto") ?? "")
    .trim()
    .slice(0, REPORT_RULES.observationMaxChars);
  if (!text) return { error: "Escreva a observação antes de salvar." };
  const ctx = await reportContext(db, me);
  const r = await (await reportFlow(db)).comment(ctx.orgId, ctx.personId, String(formData.get("id") ?? ""), text);
  if (r.status === "ok") {
    revalidatePath("/relatorios");
    return { saved: Date.now() };
  }
  const error = {
    denied: "Só a própria pessoa comenta o relatório dela.",
    not_found: "Relatório não encontrado.",
    invalid: `Limite de ${REPORT_RULES.observationsMax} observações atingido.`,
    conflict: "O relatório já seguiu ao RH e não aceita mais observações.",
  }[r.status];
  return { error };
}

/** Quem foi ajudado confirma a ajuda de um colega. Fica só a referência, no relatório de quem ajudou. */
export async function confirmarAjuda(_prev: HelpState, formData: FormData): Promise<HelpState> {
  const me = await currentPersona();
  const db = panelDb();
  if (!me || !db || me.role === "hr") return { error: "Você não pode registrar ajudas." };
  const helperId = String(formData.get("quem") ?? "");
  if (!helperId) return { error: "Escolha quem ajudou." };
  const ref = helpRef(String(formData.get("emque") ?? ""));
  if (!ref.ok) return { error: "Use o código da tarefa (ECH-128) ou o número do PR (PR 31), ou deixe em branco." };
  const ctx = await reportContext(db, me);
  const helper = ctx.people.find((p) => p.id === helperId);
  const r = await (await reportFlow(db)).confirmHelp(ctx.orgId, ctx.personId, helperId, ref.ref);
  switch (r.status) {
    case "confirmed":
      revalidatePath("/relatorios");
      return { done: helper?.name ?? "quem ajudou" };
    case "already":
      return { error: "Essa ajuda já foi registrada hoje." };
    case "invalid":
      return { error: "Referência fora do formato aceito." };
    case "denied":
      return { error: "Essa pessoa não pode receber o crédito por aqui." };
  }
}
