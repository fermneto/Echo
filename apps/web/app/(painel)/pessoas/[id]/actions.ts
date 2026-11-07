"use server";

import { canAskTwin } from "@/lib/access";
import { askAgent, panelRequest } from "@/lib/agent";
import { panelDb } from "@/lib/db";
import { findMember } from "@/lib/demo/team";
import { askTwinDemo } from "@/lib/demo/twin";
import { currentPersona } from "@/lib/session";

import { MAX_QUESTION, type AskState } from "@/lib/ask";

/** Pergunte ao gêmeo: o mesmo fluxo F2 do Slack. Sem banco ligado ao painel, vale a resposta simulada da demo. */
export async function perguntar(prev: AskState, formData: FormData): Promise<AskState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { ...prev, error: "Você não tem permissão para perguntar ao gêmeo." };

  const target = findMember(String(formData.get("pessoa") ?? ""));
  const question = String(formData.get("pergunta") ?? "").trim().slice(0, MAX_QUESTION);
  if (!target) return { ...prev, error: "Pessoa não encontrada." };
  if (!question) return { ...prev, error: "Escreva uma pergunta." };

  if (!panelDb()) {
    // A simulação responde na hora; a pausa imita o tempo de consulta do fluxo real (nota, GitHub, Linear).
    await new Promise((r) => setTimeout(r, 900));
    return { turns: [...prev.turns, { question, reply: askTwinDemo(target, question) }] };
  }
  const r = await askAgent(panelRequest({ orgId: me.orgId, askerId: me.id, ownerId: target.id, question }));
  return r.ok ? { turns: [...prev.turns, { question, reply: r.reply }] } : { ...prev, error: r.error };
}
