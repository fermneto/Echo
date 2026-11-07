"use server";

import { MAX_QUESTION, type AskState } from "@/lib/ask";
import { canAskTwin } from "@/lib/access";
import { askEchoDemo } from "@/lib/demo/echo";
import { TEAM } from "@/lib/demo/team";
import { currentNotes } from "@/lib/notes-store";
import { currentPersona } from "@/lib/session";

/** Pergunte ao Echo (agente da equipe). Hoje usa a resposta simulada; vira chamada ao fluxo F2b. */
export async function perguntarEcho(prev: AskState, formData: FormData): Promise<AskState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { ...prev, error: "Você não tem permissão para perguntar ao Echo." };
  const question = String(formData.get("pergunta") ?? "").trim().slice(0, MAX_QUESTION);
  if (!question) return { ...prev, error: "Escreva uma pergunta." };
  await new Promise((r) => setTimeout(r, 900));
  return { turns: [...prev.turns, { question, reply: askEchoDemo(question, TEAM, await currentNotes()) }] };
}
