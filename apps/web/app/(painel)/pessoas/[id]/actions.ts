"use server";

import { canAskTwin } from "@/lib/access";
import { findPersona } from "@/lib/demo/personas";
import type { AnswerResult } from "@echo/agents";
import { askTwinDemo } from "@/lib/demo/twin";
import { currentPersona } from "@/lib/session";

export type AskTurn = { question: string; reply: AnswerResult };
export type AskState = { turns: AskTurn[]; error?: string };

const MAX_QUESTION = 500;

/** Pergunte ao gêmeo. Hoje usa a resposta simulada; vira chamada ao fluxo F2 quando ele existir. */
export async function perguntar(prev: AskState, formData: FormData): Promise<AskState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { ...prev, error: "Você não tem permissão para perguntar ao gêmeo." };

  const target = findPersona(String(formData.get("pessoa") ?? ""));
  const question = String(formData.get("pergunta") ?? "").trim().slice(0, MAX_QUESTION);
  if (!target) return { ...prev, error: "Pessoa não encontrada." };
  if (!question) return { ...prev, error: "Escreva uma pergunta." };

  return { turns: [...prev.turns, { question, reply: askTwinDemo(target, question) }] };
}
