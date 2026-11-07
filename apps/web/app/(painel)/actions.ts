"use server";

import { MAX_QUESTION, type AskState } from "@/lib/ask";
import { canAskTwin } from "@/lib/access";
import { askAgent, panelRequest, recordIn } from "@/lib/agent";
import { panelDb } from "@/lib/db";
import { askEchoDemo } from "@/lib/demo/echo";
import { teamScope } from "@/lib/scope";
import { currentNotes } from "@/lib/notes-store";
import { currentPersona } from "@/lib/session";

/** Pergunte ao Echo (agente da equipe): o mesmo fluxo F2b do Slack. Sem banco ligado, vale a resposta simulada. */
export async function perguntarEcho(prev: AskState, formData: FormData): Promise<AskState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { ...prev, error: "Você não tem permissão para perguntar ao Echo." };
  const question = String(formData.get("pergunta") ?? "").trim().slice(0, MAX_QUESTION);
  if (!question) return { ...prev, error: "Escreva uma pergunta." };
  const db = panelDb();
  if (!db) {
    await new Promise((r) => setTimeout(r, 900));
    const { people } = await teamScope(me);
    return { turns: [...prev.turns, { question, reply: askEchoDemo(question, people, await currentNotes()) }] };
  }
  const r = await askAgent(panelRequest({ orgId: me.orgId, askerId: me.id, question }), { record: recordIn(db) });
  return r.ok ? { turns: [...prev.turns, { question, reply: r.reply }] } : { ...prev, error: r.error };
}
