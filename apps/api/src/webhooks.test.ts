import { sign, signVercel, type Delivery } from "@echo/connectors";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import type { WebhookDeps } from "./webhooks.ts";

const NOW = Date.parse("2026-11-07T13:00:00Z");
const nowS = Math.floor(NOW / 1000);
const ORG = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const S = { github: "gh-sec", slack: "sl-sec", linear: "li-sec" };

function setup(over: Partial<WebhookDeps> = {}) {
  const received: Delivery[] = [];
  const interactions: unknown[] = [];
  const routes: Record<string, string> = { "slack:T-DEMO": ORG, "linear:lin-org-1": ORG, "github:555": ORG };
  const deps: WebhookDeps = {
    secrets: S,
    orgSecrets: { slack: async (o) => (o === ORG ? S.slack : null), linear: async (o) => (o === ORG ? S.linear : null) },
    receive: async (d) => {
      received.push(d);
      return "queued";
    },
    routeOrg: async (kind, ext) => routes[`${kind}:${ext}`] ?? null,
    slackContext: async () => ({ registeredUserIds: new Set(["UFER"]) }),
    slackInteraction: async (_o, p) => void interactions.push(p),
    nowMs: () => NOW,
    ...over,
  };
  return { app: createApp({ ready: async () => true, webhooks: deps }), received, interactions };
}

const post = (app: ReturnType<typeof setup>["app"], path: string, body: string, headers: Record<string, string>) =>
  app.request(path, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

describe("webhook do GitHub", () => {
  const body = JSON.stringify({ installation: { id: 555 }, repository: { full_name: "org-teste/app" }, ref: "refs/heads/x", commits: [] });
  const h = (b = body) => ({ ...sign.github(S.github, b), "x-github-delivery": "d-1", "x-github-event": "push" });

  it("grava e responde 200 com assinatura válida", async () => {
    const { app, received } = setup();
    expect((await post(app, "/webhooks/github", body, h())).status).toBe(200);
    expect(received).toMatchObject([{ source: "github", deliveryId: "d-1", routeKey: "555", eventName: "push" }]);
  });

  it("recusa assinatura inválida (401) e falta de segredo (503)", async () => {
    const { app, received } = setup();
    expect((await post(app, "/webhooks/github", body, { ...h(), "x-hub-signature-256": "sha256=00" })).status).toBe(401);
    expect((await post(setup({ secrets: {} }).app, "/webhooks/github", body, h())).status).toBe(503);
    expect(received).toHaveLength(0);
  });

  it("ping responde sem gravar; falha ao gravar devolve 500 para o GitHub tentar de novo", async () => {
    const { app, received } = setup();
    expect((await post(app, "/webhooks/github", body, { ...h(), "x-github-event": "ping" })).status).toBe(200);
    expect(received).toHaveLength(0);
    const broken = setup({ receive: async () => Promise.reject(new Error("banco fora")) });
    expect((await post(broken.app, "/webhooks/github", body, h())).status).toBe(500);
  });
});

describe("webhook do Linear", () => {
  const body = JSON.stringify({ type: "Issue", action: "update", organizationId: "lin-org-1", webhookTimestamp: NOW - 1000, data: {} });
  const h = { ...sign.linear(S.linear, body), "linear-delivery": "l-1" };

  it("aceita na rota geral e na rota da própria empresa", async () => {
    const { app, received } = setup();
    expect((await post(app, "/webhooks/linear", body, h)).status).toBe(200);
    expect((await post(app, `/webhooks/linear/o/${ORG}`, body, h)).status).toBe(200);
    expect(received.map((r) => r.orgId)).toEqual([undefined, ORG]);
  });

  it("empresa sem segredo próprio responde 503; aviso de outra organização responde 403", async () => {
    const { app } = setup({ routeOrg: async () => OTHER, orgSecrets: { linear: async () => S.linear } });
    expect((await post(app, `/webhooks/linear/o/${ORG}`, body, h)).status).toBe(403);
    expect((await post(setup().app, `/webhooks/linear/o/${OTHER}`, body, h)).status).toBe(503);
    expect((await post(setup().app, "/webhooks/linear/o/nao-e-uuid", body, h)).status).toBe(503);
  });
});

describe("webhook do Jira", () => {
  const jiraSecret = "ji-sec";
  const body = JSON.stringify({ webhookEvent: "jira:issue_updated", timestamp: NOW, issue: { id: "10042", key: "ECH-128", self: "https://acme.atlassian.net/rest/api/3/issue/10042", fields: {} } });
  const h = { ...sign.jira(jiraSecret, body), "x-atlassian-webhook-identifier": "j-1" };

  it("aceita aviso assinado e grava com o site como rota e o identificador como entrega", async () => {
    const { app, received } = setup({ secrets: { ...S, jira: jiraSecret } });
    expect((await post(app, "/webhooks/jira", body, h)).status).toBe(200);
    expect(received).toMatchObject([{ source: "jira", deliveryId: "j-1", routeKey: "acme.atlassian.net" }]);
  });

  it("sem segredo 503, assinatura errada 401, sem identificador 400", async () => {
    expect((await post(setup().app, "/webhooks/jira", body, h)).status).toBe(503);
    const { app } = setup({ secrets: { ...S, jira: jiraSecret } });
    expect((await post(app, "/webhooks/jira", body, { ...sign.jira("outro", body), "x-atlassian-webhook-identifier": "j-2" })).status).toBe(401);
    expect((await post(app, "/webhooks/jira", body, sign.jira(jiraSecret, body))).status).toBe(400);
  });

  describe("um tracker por vez", () => {
    const withRoute = async (kind: string, ext: string) => (`${kind}:${ext}` === "jira:acme.atlassian.net" ? ORG : null);
    const track = (tracker: "linear" | "jira" | null) => {
      const ignored: { where: string; reason: string; detail: Record<string, string | null> }[] = [];
      const trackerCalls: string[] = [];
      const deps: Partial<WebhookDeps> = {
        secrets: { ...S, jira: jiraSecret },
        routeOrg: withRoute,
        trackerOf: async (o) => (trackerCalls.push(o), tracker),
        onIgnored: (where, reason, detail) => void ignored.push({ where, reason, detail }),
      };
      return { deps, ignored, trackerCalls };
    };

    it("só o Jira na empresa: o aviso entra no inbox da empresa da rota", async () => {
      const t = track("jira");
      const { app, received } = setup(t.deps);
      const res = await post(app, "/webhooks/jira", body, h);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("");
      expect(received).toMatchObject([{ source: "jira", deliveryId: "j-1", orgId: ORG, routeKey: "acme.atlassian.net" }]);
      expect(t.trackerCalls).toEqual([ORG]);
      expect(t.ignored).toEqual([]);
    });

    it("Linear e Jira na empresa: vale o Linear, o aviso do Jira é recusado com motivo, registrado e não vai ao inbox", async () => {
      const t = track("linear");
      const { app, received } = setup(t.deps);
      const res = await post(app, "/webhooks/jira", body, h);
      // 200 e não 409: o Jira repete 408, 409, 425, 429 e 5xx; com 200 ele não fica reenviando.
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ignored: linear ativo");
      expect(received).toEqual([]);
      expect(t.ignored).toEqual([{ where: "jira", reason: "linear ativo", detail: { deliveryId: "j-1", orgId: ORG, routeKey: "acme.atlassian.net" } }]);
    });

    it("rota do Jira tirada (o Linear ligado): recusa explícita e registrada em vez de 200 mudo", async () => {
      const t = track("linear");
      const { app } = setup({ ...t.deps, routeOrg: async () => null, receive: async () => "unrouted" });
      const res = await post(app, "/webhooks/jira", body, h);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ignored: sem rota");
      // Sem empresa, nem chega a perguntar o tracker.
      expect(t.trackerCalls).toEqual([]);
      expect(t.ignored).toMatchObject([{ where: "jira", reason: "sem rota", detail: { deliveryId: "j-1", routeKey: "acme.atlassian.net" } }]);
    });

    it("assinatura errada continua 401 antes de qualquer consulta ao tracker", async () => {
      const t = track("linear");
      const { app } = setup(t.deps);
      expect((await post(app, "/webhooks/jira", body, { ...sign.jira("outro", body), "x-atlassian-webhook-identifier": "j-3" })).status).toBe(401);
      expect(t.trackerCalls).toEqual([]);
    });
  });
});

describe("webhook do Slack", () => {
  const env = (event: Record<string, unknown>, id = "Ev1") =>
    JSON.stringify({ type: "event_callback", team_id: "T-DEMO", event_id: id, authorizations: [{ user_id: "UBOT", is_bot: true }], event });

  it("responde o desafio de verificação da URL", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc" });
    const res = await post(setup().app, "/webhooks/slack", body, sign.slack(S.slack, body, nowS));
    expect(await res.json()).toEqual({ challenge: "abc" });
  });

  it("grava a menção a pessoa cadastrada e descarta conversa entre pessoas sem gravar", async () => {
    const { app, received } = setup();
    const keep = env({ type: "message", text: "<@UFER> posso seguir?", user: "UEDU", channel: "C1", ts: "1.1" });
    const drop = env({ type: "message", text: "bom dia", user: "UEDU", channel: "C1", ts: "1.2" }, "Ev2");
    expect((await post(app, "/webhooks/slack", keep, sign.slack(S.slack, keep, nowS))).status).toBe(200);
    expect((await post(app, "/webhooks/slack", drop, sign.slack(S.slack, drop, nowS))).status).toBe(200);
    expect(received).toMatchObject([{ source: "slack", deliveryId: "Ev1", orgId: ORG }]);
  });

  it("recusa pedido antigo (reenvio forjado) e espaço de outra empresa na rota por empresa", async () => {
    const { app, received } = setup();
    const body = env({ type: "app_mention", text: "<@UBOT> oi", user: "UEDU", channel: "C1", ts: "1.3" });
    expect((await post(app, "/webhooks/slack", body, sign.slack(S.slack, body, nowS - 600))).status).toBe(401);
    const other = setup({ routeOrg: async () => OTHER });
    expect((await post(other.app, `/webhooks/slack/o/${ORG}`, body, sign.slack(S.slack, body, nowS))).status).toBe(403);
    expect(received).toHaveLength(0);
  });

  it("interação verificada segue para a fila com a empresa", async () => {
    const { app, interactions } = setup();
    const raw = new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", team: { id: "T-DEMO" }, actions: [{ action_id: "confirmar_nota" }] }) }).toString();
    const res = await app.request("/webhooks/slack/interacoes", { method: "POST", body: raw, headers: { "content-type": "application/x-www-form-urlencoded", ...sign.slack(S.slack, raw, nowS) } });
    expect(res.status).toBe(200);
    expect(interactions).toMatchObject([{ type: "block_actions" }]);
  });

  it("botões da correção (Aplicar, Recusar e o link Ver o rascunho) seguem para a fila sem filtro por action_id", async () => {
    const { app, interactions } = setup();
    const actions = [{ action_id: "correcao_aplicar", value: "f1" }, { action_id: "correcao_recusar", value: "f1" }, { action_id: "correcao_ver", url: "https://github.com/org/app/pull/2" }];
    for (const a of actions) {
      const raw = new URLSearchParams({ payload: JSON.stringify({ type: "block_actions", team: { id: "T-DEMO" }, user: { id: "UFER" }, actions: [a] }) }).toString();
      const res = await app.request("/webhooks/slack/interacoes", { method: "POST", body: raw, headers: { "content-type": "application/x-www-form-urlencoded", ...sign.slack(S.slack, raw, nowS) } });
      expect(res.status).toBe(200);
    }
    expect(interactions).toMatchObject(actions.map((a) => ({ actions: [a] })));
  });
});

describe("aviso de RH", () => {
  const ORG_RH = "33333333-3333-3333-3333-333333333333";
  const body = JSON.stringify({ id: "evento-1", employee_id: "123", starts_at: "2026-11-10T00:00:00-03:00", ends_at: "2026-11-21T23:59:59-03:00", kind: "vacation", motivo: "não guardar" });
  function rh(over: Partial<WebhookDeps> = {}) {
    const got: unknown[] = [];
    const { app } = setup({
      orgSecrets: { hr: async (o) => (o === ORG_RH ? "rh-sec" : null) },
      hr: async (_o, ev) => (got.push(ev), { status: "registered", absenceId: "a1", personId: "p1" }),
      ...over,
    });
    return { app, got };
  }

  it("aceita aviso assinado e entrega sem o motivo", async () => {
    const { app, got } = rh();
    const res = await post(app, `/webhooks/rh/o/${ORG_RH}`, body, sign.hr("rh-sec", body, nowS));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "registered" });
    expect(JSON.stringify(got)).not.toContain("não guardar");
  });

  it("recusa assinatura velha (401), empresa sem segredo (503) e aviso inválido (400)", async () => {
    const { app } = rh();
    expect((await post(app, `/webhooks/rh/o/${ORG_RH}`, body, sign.hr("rh-sec", body, nowS - 400))).status).toBe(401);
    expect((await post(app, `/webhooks/rh/o/${OTHER}`, body, sign.hr("rh-sec", body, nowS))).status).toBe(503);
    const bad = JSON.stringify({ id: "x", employee_id: "1", starts_at: "2026-11-10", ends_at: "2026-11-11", kind: "vacation" });
    expect((await post(app, `/webhooks/rh/o/${ORG_RH}`, bad, sign.hr("rh-sec", bad, nowS))).status).toBe(400);
  });
});

describe("webhook da Vercel", () => {
  const body = JSON.stringify({ id: "evt_1", type: "deployment.succeeded", createdAt: NOW, payload: { team: { id: "team_x" }, target: "production", deployment: { id: "dpl_1", url: "app.vercel.app", meta: {} } } });

  it("grava o deploy com a rota do time; recusa assinatura errada e falta de segredo", async () => {
    const { app, received } = setup({ secrets: { ...S, vercel: "vc-sec" } });
    expect((await post(app, "/webhooks/vercel", body, signVercel("vc-sec", body))).status).toBe(200);
    expect(received).toMatchObject([{ source: "vercel", deliveryId: "evt_1", routeKey: "team_x" }]);
    expect((await post(app, "/webhooks/vercel", body, signVercel("outro", body))).status).toBe(401);
    expect((await post(setup().app, "/webhooks/vercel", body, signVercel("vc-sec", body))).status).toBe(503);
  });

  it("evento que não é de deploy responde 200 sem gravar", async () => {
    const other = JSON.stringify({ id: "evt_2", type: "project.created", payload: {} });
    const { app, received } = setup({ secrets: { ...S, vercel: "vc-sec" } });
    expect((await post(app, "/webhooks/vercel", other, signVercel("vc-sec", other))).status).toBe(200);
    expect(received).toHaveLength(0);
  });
});
