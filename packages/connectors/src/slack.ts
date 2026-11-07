import type { ChatMessage, NormalizedEvent } from "./normalized.ts";

/** Reações que confirmam ajuda. */
export const HELP_REACTIONS = new Set(["pray", "raised_hands", "obrigado", "ajudou"]);

/** "alguém sabe de pagamentos?" — e não "quem sabe amanhã" (sentido de talvez). */
const WHO_KNOWS = /\b(algu[eé]m|quem)\s+(sabe|entende|conhece|manja)\s+(de|sobre|do|da|dos|das|como|o que)\b/i;
export const isWhoKnows = (text: string) => WHO_KNOWS.test(text);

const mentionsIn = (text: string) => [...text.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].map((m) => m[1]!);

export interface SlackEntryContext {
  /** user_id do bot Echo no espaço. */
  botUserId?: string | undefined;
  /** Ids do Slack das pessoas cadastradas na empresa. */
  registeredUserIds: ReadonlySet<string>;
}

/**
 * Decide NA ENTRADA, sem gravar nada, se a mensagem interessa ao Echo (limitacoes-integracoes: mensagens
 * avaliadas em memória; só vira registro o que gera pergunta). Presença NÃO é lida aqui: só no worker, na menção.
 */
export function slackShouldKeep(event: any, ctx: SlackEntryContext): { keep: boolean; reason: string } {
  if (event?.type === "reaction_added") {
    return HELP_REACTIONS.has(event.reaction) ? { keep: true, reason: "reação de ajuda" } : { keep: false, reason: "reação comum" };
  }
  if (event?.type === "app_mention") return { keep: true, reason: "menção ao bot" };
  if (event?.type !== "message") return { keep: false, reason: `evento ${event?.type} não usado` };
  if (event.bot_id || event.subtype) return { keep: false, reason: "mensagem de bot ou editada" };
  const text: string = event.text ?? "";
  if (event.channel_type === "im") return { keep: true, reason: "conversa privada com o bot" };
  if (ctx.botUserId && event.parent_user_id === ctx.botUserId) return { keep: true, reason: "tópico do Echo" };
  const mentions = mentionsIn(text);
  // A menção ao bot já chega como app_mention: a cópia em "message" seria pergunta duplicada.
  if (ctx.botUserId && mentions.includes(ctx.botUserId)) return { keep: false, reason: "coberta por app_mention" };
  if (mentions.some((m) => ctx.registeredUserIds.has(m))) return { keep: true, reason: "cita pessoa cadastrada" };
  if (isWhoKnows(text)) return { keep: true, reason: "quem sabe" };
  return { keep: false, reason: "conversa entre pessoas" };
}

/** Normaliza um event_callback do Slack já aceito pelo filtro de entrada. */
export function normalizeSlack(envelope: any, botUserId?: string): NormalizedEvent[] {
  const e = envelope?.event;
  if (!e) return [{ kind: "ignored", reason: "slack sem evento" }];
  if (e.type === "reaction_added") {
    if (e.item?.type !== "message" || !e.item_user) return [{ kind: "ignored", reason: "reação fora de mensagem" }];
    return [{ kind: "reaction", channel: e.item.channel, ts: e.item.ts, reaction: e.reaction, reactorExternalId: e.user, authorExternalId: e.item_user, at: new Date(Number(e.event_ts) * 1000) }];
  }
  if (e.type === "app_mention" || e.type === "message") {
    const text: string = e.text ?? "";
    const mentions = mentionsIn(text);
    const message: ChatMessage = {
      channel: e.channel,
      ts: e.ts,
      threadTs: e.thread_ts,
      userExternalId: e.user,
      text,
      mentions: mentions.filter((m) => m !== botUserId),
      mentionsBot: e.type === "app_mention" || (botUserId ? mentions.includes(botUserId) : false),
      isDm: e.channel_type === "im",
      parentUserId: e.parent_user_id,
    };
    return [{ kind: "chat_message", message }];
  }
  return [{ kind: "ignored", reason: `slack ${e.type} não usado` }];
}
