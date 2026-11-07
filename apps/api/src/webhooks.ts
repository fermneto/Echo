import {
  parseHrEvent,
  verifyHr,
  type HrEvent,
  type HrResult,
  githubRouteKey,
  vercelRouteKey,
  verifyVercel,
  linearRouteKey,
  slackShouldKeep,
  verifyGithub,
  verifyLinear,
  verifySlack,
  type Delivery,
  type InboxSource,
  type SlackEntryContext,
} from "@echo/connectors";
import type { Context, Hono } from "hono";

export interface WebhookDeps {
  secrets: { github?: string | undefined; slack?: string | undefined; linear?: string | undefined; vercel?: string | undefined };
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
  nowMs?: () => number;
  onError?: (err: unknown, where: string) => void;
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
