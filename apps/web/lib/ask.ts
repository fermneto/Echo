import type { AnswerResult } from "@echo/agents";

/** Estado de uma conversa no painel (gêmeo de uma pessoa ou Echo da equipe). */
export type AskTurn = { question: string; reply: AnswerResult };
export type AskState = { turns: AskTurn[]; error?: string };
export const MAX_QUESTION = 500;
