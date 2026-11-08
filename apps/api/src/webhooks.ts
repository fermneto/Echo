import {
  parseHrEvent,
  verifyHr,
  type HrEvent,
  type HrResult,
  githubRouteKey,
  vercelRouteKey,
  verifyVercel,
  jiraRouteKey,
  linearRouteKey,
  slackShouldKeep,
  verifyGithub,
  verifyJira,
  verifyLinear,
  verifySlack,
  type Delivery,
  type InboxSource,
  type SlackEntryContext,
  type TrackerKind,
} from "@echo/connectors";
import type { Context, Hono } from "hono";

export interface WebhookDeps {
  secrets: { github?: string | undefined; slack?: string | undefined; linear?: string | undefined; jira?: string | undefined; vercel?: string | undefined };
  /** Segredos por empresa, para as rotas /o/<empresa>. Sem eles, essas rotas respondem 503. */
  orgSecrets?: {
    slack?: (orgId: string) => Promise<string | null>;
    linear?: (orgId: string) => Promise<string | null>;
    hr?: (orgId: string) => Promise<string | null>;
  };
  /** Aviso de RH já verificado: grava a ausência (ou o cancelamento). */
  hr?: (orgId: string, event: HrEvent) => Promise<HrResult>;
  receive: (d: Delivery) => Promise<"queued" | "duplicate" | "unrouted">;
  routeOrg: (kind: InboxSource, externalId: string) => Promise<string | null>;
  /** Pessoas cadastradas no Slack da empresa, para o descarte na entrada. */
  slackContext: (orgId: string) => Promise<Omit<SlackEntryContext, "botUserId">>;
  /** Clique em botão já verificado; o processamento é da frente Funções. */
  slackInteraction?: (orgId: string, payload: unknown) => Promise<void>;
  /**
   * Tracker que vale na empresa (um por vez; com o Linear, o Jira fica de fora). Sem a função, o aviso do Jira
   * segue para o inbox como antes.
   */
  trackerOf?: (orgId: string) => Promise<TrackerKind | null>;
  nowMs?: () => number;
  onError?: (err: unknown, where: string) => void;
  /** Aviso válido recusado de propósito (ex.: Jira com o Linear ativo). Sem conteúdo do aviso, só ids. */
  onIgnored?: (where: string, reason: string, detail: Record<string, string | null>) => void;
}

const headersOf = (c: Context) => Object.fromEntries(c.req.raw.headers.entries());
const parseJson = (raw: string): any => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * Webhooks (F1): validar a assinatura, gravar em inbox_events, enfileirar e responder 200 no prazo
 * (3 s Slack, 5 s Linear, 10 s GitHub). Nada de processamento aqui.
 */
export function registerWebhooks(app: Hono, deps: WebhookDeps): void {
  const now = () => deps.nowMs?.() ?? Date.now();
  const fail = (c: Context, err: unknown, where: string) => {
    deps.onError?.(err, where);
    // 500 faz a plataforma tentar de novo; o inbox_events evita processar duas vezes.
    return c.body(null, 500);
  };

  // ---------- GitHub
  app.post("/webhooks/github", async (c) => {
    const secret = deps.secrets.github;
    if (!secret) return c.body(null, 503);
    const raw = await c.req.text();
    if (!verifyGithub(secret, raw, headersOf(c)).ok) return c.body(null, 401);
    const body = parseJson(raw);
    const deliveryId = c.req.header("x-github-delivery");
    const eventName = c.req.header("x-github-event");
    if (!body || !deliveryId || !eventName) return c.body(null, 400);
    if (eventName === "ping") return c.json({ ok: true });
    try {
      await deps.receive({ source: "github", deliveryId, routeKey: githubRouteKey(body), eventName, payload: body });
      return c.body(null, 200);
    } catch (err) {
      return fail(c, err, "github");
    }
  });

  // ---------- Vercel (deploys de preview e produção)
  app.post("/webhooks/vercel", async (c) => {
    const secret = deps.secrets.vercel;
    if (!secret) return c.body(null, 503);
    const raw = await c.req.text();
    if (!verifyVercel(secret, raw, headersOf(c)).ok) return c.body(null, 401);
    const body = parseJson(raw);
    if (!body?.id || !body?.type) return c.body(null, 400);
    if (!String(body.type).startsWith("deployment.")) return c.body(null, 200);
    try {
      await deps.receive({ source: "vercel", deliveryId: body.id, routeKey: vercelRouteKey(body), payload: body });
      return c.body(null, 200);
    } catch (err) {
      return fail(c, err, "vercel");
    }
  });

  // ---------- Linear
  const linear = async (c: Context, secret: string | null | undefined, fixedOrg: string | null) => {
    if (!secret) return c.body(null, 503);
    const raw = await c.req.text();
    if (!verifyLinear(secret, raw, headersOf(c), now()).ok) return c.body(null, 401);
    const body = parseJson(raw);
    const deliveryId = c.req.header("linear-delivery");
    if (!body || !deliveryId) return c.body(null, 400);
    const routeKey = linearRouteKey(body);
    // Uma empresa só fala pelas próprias instalações, mesmo assinando certo.
    if (fixedOrg && routeKey && (await deps.routeOrg("linear", routeKey)) !== fixedOrg) return c.body(null, 403);
    try {
      await deps.receive({ source: "linear", deliveryId, orgId: fixedOrg ?? undefined, routeKey, payload: body });
      return c.body(null, 200);
    } catch (err) {
      return fail(c, err, "linear");
    }
  };
  app.post("/webhooks/linear", (c) => linear(c, deps.secrets.linear, null));
  app.post("/webhooks/linear/o/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    return linear(c, isUuid(orgId) ? await deps.orgSecrets?.linear?.(orgId) : null, orgId);
  });

  // ---------- Jira Cloud (etapa 21): mesmas tarefas do Linear, para empresas que usam Jira
  // Aviso recusado de propósito: 200 (o Jira repete 408, 409, 425, 429 e 5xx; 200 encerra), corpo com o motivo,
  // registro em log e nada no inbox.
  const ignored = (c: Context, where: string, reason: string, detail: Record<string, string | null>) => {
    deps.onIgnored?.(where, reason, detail);
    return c.text(`ignored: ${reason}`, 200);
  };
  const jira = async (c: Context, secret: string | null | undefined, fixedOrg: string | null) => {
    if (!secret) return c.body(null, 503);
    const raw = await c.req.text();
    if (!verifyJira(secret, raw, headersOf(c)).ok) return c.body(null, 401);
    const body = parseJson(raw);
    // Único por entrega e igual nas novas tentativas do Jira: é a chave de idempotência.
    const deliveryId = c.req.header("x-atlassian-webhook-identifier");
    if (!body || !deliveryId) return c.body(null, 400);
    const routeKey = jiraRouteKey(body);
    try {
      const routed = routeKey ? await deps.routeOrg("jira", routeKey) : null;
      if (fixedOrg && routeKey && routed !== fixedOrg) return c.body(null, 403);
      const orgId = fixedOrg ?? routed;
      // Um tracker por vez: com o Linear ativo na empresa, o aviso do Jira não entra (as chaves dos dois colidem).
      if (orgId && (await deps.trackerOf?.(orgId)) === "linear") return ignored(c, "jira", "linear ativo", { deliveryId, orgId, routeKey: routeKey ?? null });
      const r = await deps.receive({ source: "jira", deliveryId, orgId: orgId ?? undefined, routeKey, payload: body });
      // Sem rota (ex.: `integracoes:ligar` tirou a do Jira porque o Linear está ligado): recusa explícita, não silêncio.
      if (r === "unrouted") return ignored(c, "jira", "sem rota", { deliveryId, orgId: null, routeKey: routeKey ?? null });
      return c.body(null, 200);
    } catch (err) {
      return fail(c, err, "jira");
    }
  };
  app.post("/webhooks/jira", (c) => jira(c, deps.secrets.jira, null));

  // ---------- Slack: eventos
  const slackEvents = async (c: Context, secret: string | null | undefined, fixedOrg: string | null) => {
    if (!secret) return c.body(null, 503);
    const raw = await c.req.text();
    if (!verifySlack(secret, raw, headersOf(c), now()).ok) return c.body(null, 401);
    const body = parseJson(raw);
    if (!body) return c.body(null, 400);
    if (body.type === "url_verification") return c.json({ challenge: body.challenge });
    if (body.type !== "event_callback" || !body.event_id || !body.team_id) return c.body(null, 200);
    try {
      const orgId = await deps.routeOrg("slack", body.team_id);
      if (!orgId || (fixedOrg && orgId !== fixedOrg)) return c.body(null, fixedOrg ? 403 : 200);
      const botUserId = (body.authorizations as { user_id?: string; is_bot?: boolean }[] | undefined)?.find((a) => a.is_bot)?.user_id;
      const ctx = await deps.slackContext(orgId);
      // Descarte na entrada: o que não interessa ao Echo não é gravado.
      if (!slackShouldKeep(body.event, { ...ctx, botUserId }).keep) return c.body(null, 200);
      await deps.receive({ source: "slack", deliveryId: body.event_id, orgId, payload: body });
      return c.body(null, 200);
    } catch (err) {
      return fail(c, err, "slack");
    }
  };
  app.post("/webhooks/slack", (c) => slackEvents(c, deps.secrets.slack, null));
  app.post("/webhooks/slack/o/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    return slackEvents(c, isUuid(orgId) ? await deps.orgSecrets?.slack?.(orgId) : null, orgId);
  });

  // ---------- Slack: interações (botões)
  const slackInteractions = async (c: Context, secret: string | null | undefined, fixedOrg: string | null) => {
    if (!secret) return c.body(null, 503);
    const raw = await c.req.text();
    if (!verifySlack(secret, raw, headersOf(c), now()).ok) return c.body(null, 401);
    const payload = parseJson(new URLSearchParams(raw).get("payload") ?? "");
    const teamId: string | undefined = payload?.team?.id ?? payload?.user?.team_id;
    if (!payload || !teamId) return c.body(null, 400);
    try {
      const orgId = await deps.routeOrg("slack", teamId);
      if (!orgId || (fixedOrg && orgId !== fixedOrg)) return c.body(null, 403);
      await deps.slackInteraction?.(orgId, payload);
      // O retorno visível vai pelo response_url, a cargo de quem processa o clique.
      return c.body(null, 200);
    } catch (err) {
      return fail(c, err, "slack.interacoes");
    }
  };
  app.post("/webhooks/slack/interacoes", (c) => slackInteractions(c, deps.secrets.slack, null));
  app.post("/webhooks/slack/o/:orgId/interacoes", async (c) => {
    const orgId = c.req.param("orgId");
    return slackInteractions(c, isUuid(orgId) ? await deps.orgSecrets?.slack?.(orgId) : null, orgId);
  });

  // ---------- Aviso de RH (genérico, por empresa)
  app.post("/webhooks/rh/o/:orgId", async (c) => {
    const orgId = c.req.param("orgId");
    const secret = isUuid(orgId) ? await deps.orgSecrets?.hr?.(orgId) : null;
    if (!secret || !deps.hr) return c.body(null, 503);
    const raw = await c.req.text();
    // Mais de 5 minutos de diferença é recusado (reenvio forjado).
    if (!verifyHr(secret, raw, headersOf(c), now()).ok) return c.body(null, 401);
    const event = parseHrEvent(parseJson(raw));
    if (!event) return c.json({ error: "aviso inválido: id, employee_id, starts_at e ends_at com fuso, kind vacation ou leave" }, 400);
    try {
      const r = await deps.hr(orgId, event);
      // Matrícula desconhecida responde 200 (o RH não deve tentar de novo), sem dizer qual.
      return c.json({ ok: true, status: r.status });
    } catch (err) {
      return fail(c, err, "rh");
    }
  });
}
