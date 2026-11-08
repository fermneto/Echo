// Adaptador do Slack para a porta ChatPlatform (Web API por HTTP, sem SDK).
// Regras: status lido só na menção e nunca gravado nem logado; o agente sempre se identifica.
import type { ChatPlatform, Presence } from "./index.ts";

/** Ids dos botões. Quem processa os cliques (frente Funções) usa as mesmas constantes. */
export const SLACK_ACTIONS = {
  answerHelpful: "answer_helpful",
  answerNotHelpful: "answer_not_helpful",
  confirmDailyNote: "daily_note_confirm",
  editDailyNote: "daily_note_edit",
} as const;

/** Limites do Slack: 3.000 caracteres por bloco de texto, 4.000 no texto da mensagem. */
const MAX_SECTION = 3_000;
const MAX_TEXT = 4_000;

export class SlackApiError extends Error {
  override name = "SlackApiError";
  constructor(
    readonly method: string,
    readonly code: string,
  ) {
    super(`Slack ${method}: ${code}`);
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SlackClientOptions {
  /** Token do bot (xoxb-…). */
  token: string;
  fetch?: FetchLike;
  baseUrl?: string;
  /** Limite padrão de cada chamada. */
  timeoutMs?: number;
  /** Espera antes de tentar de novo quando o Slack pede (429). Trocável nos testes. */
  sleep?: (ms: number) => Promise<void>;
}

/** Corta o texto no limite, avisando que o restante está no painel. */
export function fitText(text: string, max = MAX_TEXT, suffix = "\n…(continua no painel)"): string {
  return text.length <= max ? text : text.slice(0, max - suffix.length) + suffix;
}

/** Fontes no rodapé da resposta, sempre visíveis. */
export function sourcesLine(sources: { label: string }[]): string {
  return sources.length ? `Fontes: ${sources.map((s) => s.label).join(" · ")}` : "";
}

/** Resposta do agente com fontes e os botões Resolveu / Não resolveu (só quem perguntou vale, checado no clique). */
export function answerBlocks(input: { text: string; sources: { label: string }[]; questionId?: string }): unknown[] | undefined {
  if (input.text.length > MAX_SECTION) return undefined;
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: input.text } }];
  const src = sourcesLine(input.sources);
  if (src) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: fitText(src, MAX_SECTION) }] });
  if (input.questionId) {
    const button = (label: string, action_id: string) => ({ type: "button", text: { type: "plain_text", text: label }, action_id, value: input.questionId });
    blocks.push({ type: "actions", elements: [button("Resolveu", SLACK_ACTIONS.answerHelpful), button("Não resolveu", SLACK_ACTIONS.answerNotHelpful)] });
  }
  return blocks;
}

/** Rascunho da nota do dia por mensagem privada, com Confirmar e Editar no painel. */
export function dailyNoteDraftBlocks(input: { text: string; noteId: string; panelUrl?: string }): unknown[] {
  return [
    { type: "section", text: { type: "mrkdwn", text: fitText(input.text, MAX_SECTION) } },
    {
      type: "actions",
      elements: [
        { type: "button", style: "primary", action_id: SLACK_ACTIONS.confirmDailyNote, value: input.noteId, text: { type: "plain_text", text: "Confirmar" } },
        ...(input.panelUrl
          ? [{ type: "button", action_id: SLACK_ACTIONS.editDailyNote, url: `${input.panelUrl}/nota-do-dia`, text: { type: "plain_text", text: "Editar no painel" } }]
          : []),
      ],
    },
  ];
}

/** Métodos que não aceitam corpo JSON (o Slack ignora os argumentos em silêncio). */
const FORM_METHODS = /^(users\.|auth\.test$)/;

export class SlackChat implements ChatPlatform {
  private readonly fetch: FetchLike;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: SlackClientOptions) {
    this.fetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.base = opts.baseUrl ?? "https://slack.com/api";
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Chamada à Web API. Tenta de novo uma vez quando o Slack pede para esperar (429).
   * Métodos de leitura (users.*, auth.test) vão como formulário: neles o Slack ignora corpo JSON.
   * Em users.getPresence, isso devolvia o status do próprio bot ("active") para qualquer pessoa.
   */
  async call<T = Record<string, unknown>>(method: string, body: Record<string, unknown>, timeoutMs = this.timeoutMs): Promise<T> {
    const form = FORM_METHODS.test(method);
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(`${this.base}/${method}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.opts.token}`, "content-type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
        body: form ? new URLSearchParams(Object.entries(body).map(([k, v]): [string, string] => [k, String(v)])).toString() : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 && attempt === 0) {
        const wait = Math.min(Number(res.headers.get("retry-after") ?? "1"), 10) * 1000;
        await this.sleep(wait);
        continue;
      }
      if (!res.ok) throw new SlackApiError(method, `http_${res.status}`);
      const data = (await res.json()) as { ok: boolean; error?: string } & T;
      if (!data.ok) throw new SlackApiError(method, data.error ?? "erro_desconhecido");
      return data;
    }
  }

  /**
   * Status lido só na menção, com limite de 1,5 s. Qualquer falha ou demora vira "unknown",
   * e quem chama usa isAway como reserva. O resultado não é gravado nem vai para log.
   */
  async getPresence(userExternalId: string, timeoutMs = 1_500): Promise<Presence> {
    try {
      const data = await this.call<{ presence?: string }>("users.getPresence", { user: userExternalId }, timeoutMs);
      return data.presence === "active" ? "active" : data.presence === "away" ? "away" : "unknown";
    } catch {
      return "unknown";
    }
  }

  /** "Consultando…" só para quem chamou. */
  async postEphemeral(channel: string, userExternalId: string, text: string, threadTs?: string): Promise<void> {
    await this.call("chat.postEphemeral", { channel, user: userExternalId, text: fitText(text), ...(threadTs ? { thread_ts: threadTs } : {}) });
  }

  /**
   * Resposta identificada como agente ("Agente de Fernando"): o nome personalizado exige chat:write.customize.
   * Sem links expandidos, para não puxar prévias de conteúdo de terceiros.
   */
  async postAgentReply(input: { channel: string; threadTs?: string; agentName: string; blocks?: unknown[]; text: string; iconUrl?: string }): Promise<{ ts: string }> {
    const data = await this.call<{ ts: string }>("chat.postMessage", {
      channel: input.channel,
      text: fitText(input.text),
      username: input.agentName,
      unfurl_links: false,
      unfurl_media: false,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      ...(input.blocks ? { blocks: input.blocks } : {}),
      ...(input.iconUrl ? { icon_url: input.iconUrl } : {}),
    });
    return { ts: data.ts };
  }

  /**
   * Aviso temporário no tópico ("Agente de Fernando consultando…"). É mensagem comum, e não efêmera,
   * porque o Slack não deixa o bot apagar mensagem efêmera; quem chama apaga com deleteMessage.
   */
  async postNotice(input: { channel: string; threadTs?: string; agentName: string; text: string; iconUrl?: string }): Promise<{ channel: string; ts: string } | null> {
    const data = await this.call<{ channel?: string; ts?: string }>("chat.postMessage", {
      channel: input.channel,
      text: fitText(input.text),
      username: input.agentName,
      unfurl_links: false,
      unfurl_media: false,
      ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
      ...(input.iconUrl ? { icon_url: input.iconUrl } : {}),
    });
    return data.ts ? { channel: data.channel ?? input.channel, ts: data.ts } : null;
  }

  /** Mensagem privada do bot Echo à pessoa (nota do dia, plano, resumo). Vai para a aba Mensagens do app. */
  async sendDm(userExternalId: string, input: { text: string; blocks?: unknown[] }): Promise<void> {
    await this.call("chat.postMessage", {
      channel: userExternalId,
      text: fitText(input.text),
      unfurl_links: false,
      unfurl_media: false,
      ...(input.blocks ? { blocks: input.blocks } : {}),
    });
  }

  /** Apaga uma mensagem do próprio bot (por exemplo, um aviso que deixou de valer). */
  async deleteMessage(channel: string, ts: string): Promise<void> {
    await this.call("chat.delete", { channel, ts });
  }

  /** Identidade do bot no espaço: user_id e team_id (DEMO_SLACK_TEAM_ID sai daqui). */
  async authTest(): Promise<{ userId: string; teamId: string; botId?: string }> {
    const d = await this.call<{ user_id: string; team_id: string; bot_id?: string }>("auth.test", {});
    return { userId: d.user_id, teamId: d.team_id, ...(d.bot_id ? { botId: d.bot_id } : {}) };
  }

  /** Pessoas do espaço, para ligar identidades no cadastro (sem bots nem contas desativadas). */
  async listUsers(): Promise<{ id: string; name: string; tz?: string }[]> {
    const out: { id: string; name: string; tz?: string }[] = [];
    let cursor = "";
    do {
      const d = await this.call<{ members: any[]; response_metadata?: { next_cursor?: string } }>("users.list", { limit: 200, ...(cursor ? { cursor } : {}) });
      for (const m of d.members) {
        if (m.is_bot || m.deleted || m.id === "USLACKBOT") continue;
        out.push({ id: m.id, name: m.profile?.real_name || m.real_name || m.name, ...(m.tz ? { tz: m.tz } : {}) });
      }
      cursor = d.response_metadata?.next_cursor ?? "";
    } while (cursor);
    return out;
  }
}

/**
 * Resposta a um clique pelo response_url. O Slack ignora o corpo da resposta HTTP nos botões,
 * então o retorno visível vai por aqui.
 */
export async function respondToInteraction(responseUrl: string, body: object, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<void> {
  if (!/^https:\/\/hooks\.slack\.com\//.test(responseUrl)) throw new Error("response_url fora do domínio do Slack");
  const res = await fetchImpl(responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new SlackApiError("response_url", `http_${res.status}`);
}
