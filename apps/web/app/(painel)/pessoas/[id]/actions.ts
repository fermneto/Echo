"use server";

import { canAskTwin } from "@/lib/access";
import { askAgent, panelRequest, personIdFor, recordIn } from "@/lib/agent";
import { saveDemoProfile } from "@/lib/agent-profile-store";
import { gainsOrgId } from "@/lib/gains";
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

  const db = panelDb();
  if (!db) {
    // A simulação responde na hora; a pausa imita o tempo de consulta do fluxo real (nota, GitHub, Linear).
    await new Promise((r) => setTimeout(r, 900));
    return { turns: [...prev.turns, { question, reply: askTwinDemo(target, question) }] };
  }
  const r = await askAgent(panelRequest({ orgId: me.orgId, askerId: me.id, ownerId: target.id, question }), { record: recordIn(db) });
  return r.ok ? { turns: [...prev.turns, { question, reply: r.reply }] } : { ...prev, error: r.error };
}

export type ProfileState = { saved?: string; error?: string };

/** O próprio texto do agente: como ele responde e até onde decide pela pessoa. Só a pessoa grava o dela. */
export async function salvarPerfilDoAgente(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const me = await currentPersona();
  if (!me || String(formData.get("pessoa") ?? "") !== me.id) return { error: "Só a própria pessoa muda o jeito do agente dela." };
  const db = panelDb();
  const input = { style: String(formData.get("estilo") ?? ""), delegation: String(formData.get("delegacao") ?? "") };
  if (!db) {
    // Demonstração sem banco: fica só neste navegador.
    await saveDemoProfile(input, new Date());
    return { saved: new Date().toISOString() };
  }
  const { saveAgentProfile } = await import("@echo/agents/perfil");
  const ok = await saveAgentProfile(db, gainsOrgId(me.orgId), personIdFor(me.id), input, new Date());
  return ok ? { saved: new Date().toISOString() } : { error: "Pessoa não encontrada nesta empresa." };
}
