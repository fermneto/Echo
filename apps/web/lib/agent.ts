import type { AnswerRequest, AnswerResult } from "@echo/agents";
import { gainsOrgId } from "./gains";

/** Pessoas da demonstração no banco (seed/src/demo.ts → DEMO_IDS.people). */
export const DEMO_PERSON_IDS: Readonly<Record<string, string>> = {
  fernando: "00000000-0000-4000-8000-000000000101",
  eduardo: "00000000-0000-4000-8000-000000000102",
  yan: "00000000-0000-4000-8000-000000000103",
  marina: "00000000-0000-4000-8000-000000000104",
  bruno: "00000000-0000-4000-8000-000000000105",
  carla: "00000000-0000-4000-8000-000000000106",
  rita: "00000000-0000-4000-8000-000000000107",
};

/** Id da pessoa no banco: a persona da demo vira a pessoa do seed; quem entrou pelo Slack já tem o id real. */
export function personIdFor(id: string): string {
  return DEMO_PERSON_IDS[id] ?? id;
}

/** Pedido ao fluxo F2 (gêmeo) ou F2b (Echo da equipe), igual ao do Slack, com o canal do painel. */
export function panelRequest(input: { orgId: string; askerId: string; ownerId?: string; question: string }): AnswerRequest {
  return {
    // As personas da demo usam a empresa do seed.
    orgId: gainsOrgId(input.orgId),
    askerId: personIdFor(input.askerId),
    ...(input.ownerId ? { ownerId: personIdFor(input.ownerId) } : {}),
    text: input.question,
    channel: "painel",
  };
}

export type PanelAnswer = { ok: true; reply: AnswerResult } | { ok: false; error: string };

/**
 * Chama o mesmo answer() do Slack. Import tardio: o SDK da Anthropic só carrega quando alguém pergunta.
 * Falha vira mensagem na tela, nunca resposta simulada no lugar da real.
 */
export async function askAgent(req: AnswerRequest, run?: (req: AnswerRequest) => Promise<AnswerResult>): Promise<PanelAnswer> {
  try {
    const answer = run ?? (await import("@echo/agents")).answer;
    return { ok: true, reply: await answer(req) };
  } catch (err) {
    console.error("pergunta do painel falhou", err instanceof Error ? err.message : String(err));
    return { ok: false, error: "O agente não conseguiu responder agora. Tente de novo em instantes." };
  }
}
