"use server";

import { MAX_QUESTION } from "@/lib/ask";
import { canAskTwin } from "@/lib/access";
import { TEAM } from "@/lib/demo/team";
import { appendMessage, type ChannelState, ECHO_TARGET, mentionTargets, parseMention } from "@/lib/simulator";
import { currentPersona } from "@/lib/session";
import { perguntarEcho } from "../actions";
import { perguntar } from "../pessoas/[id]/actions";

/**
 * Mensagem no canal simulado. Passa pelas mesmas ações da ficha e do Echo: com banco, o answer() real do Slack;
 * sem banco, as respostas simuladas da demo.
 */
export async function enviarNoCanal(prev: ChannelState, formData: FormData): Promise<ChannelState> {
  const me = await currentPersona();
  if (!me || !canAskTwin(me.role)) return { ...prev, error: "Você não tem permissão para mencionar os agentes." };
  const targets = mentionTargets(TEAM, me.id);
  const chosen = String(formData.get("alvo") ?? ECHO_TARGET);
  const { target, question } = parseMention(String(formData.get("mensagem") ?? "").slice(0, MAX_QUESTION), targets, chosen);
  if (!targets.some((t) => t.id === target)) return { ...prev, error: "Escolha quem mencionar." };
  if (!question) return { ...prev, error: "Escreva a mensagem." };

  const form = new FormData();
  form.set("pergunta", question);
  if (target !== ECHO_TARGET) form.set("pessoa", target);
  const r = target === ECHO_TARGET ? await perguntarEcho({ turns: [] }, form) : await perguntar({ turns: [] }, form);
  const turn = r.turns.at(-1);
  if (r.error || !turn) return { ...prev, error: r.error ?? "O agente não conseguiu responder agora." };
  return appendMessage(prev, { target, question, reply: turn.reply, at: new Date().toISOString() });
}
