import type { AnswerResult } from "@echo/agents";

/**
 * Simulador do canal do Slack: quem pode ser mencionado e como a mensagem vira pergunta ao fluxo.
 * Regras puras, testadas em simulator.test.ts.
 */

export const ECHO_TARGET = "echo";

export type MentionTarget = { id: string; handle: string; agent: string; away: boolean };

type TeamMember = { id: string; name: string; role: string; active?: boolean; availability: { kind: string } };

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** O Echo e o agente de cada colega (sem quem pergunta e sem o RH, que não tem gêmeo de trabalho). */
export function mentionTargets(team: readonly TeamMember[], meId: string): MentionTarget[] {
  const people = team
    .filter((p) => p.id !== meId && p.role !== "hr" && p.active !== false)
    .map((p) => ({ id: p.id, handle: first(p.name), agent: `Agente de ${first(p.name)}`, away: p.availability.kind !== "working" }));
  return [{ id: ECHO_TARGET, handle: "Echo", agent: "Echo", away: false }, ...people];
}

/**
 * "@Fernando posso seguir?" escolhe o agente do Fernando e tira a menção do texto, como o Slack entrega a mensagem.
 * Sem menção conhecida no começo, vale o alvo escolhido na tela.
 */
export function parseMention(text: string, targets: readonly MentionTarget[], fallback: string): { target: string; question: string } {
  const t = text.trim();
  const m = /^@(\S+)\s*(.*)$/s.exec(t);
  if (m) {
    const handle = m[1]!.replace(/[,:]$/, "").toLowerCase();
    const hit = targets.find((x) => x.handle.toLowerCase() === handle);
    if (hit) return { target: hit.id, question: m[2]!.trim() };
  }
  return { target: fallback, question: t };
}

export type ChannelMessage = { id: number; target: string; question: string; reply: AnswerResult; at: string };
export type ChannelState = { messages: ChannelMessage[]; error?: string };
export const MAX_MESSAGES = 30;

export function appendMessage(state: ChannelState, msg: Omit<ChannelMessage, "id">): ChannelState {
  const id = (state.messages.at(-1)?.id ?? 0) + 1;
  return { messages: [...state.messages, { ...msg, id }].slice(-MAX_MESSAGES) };
}
