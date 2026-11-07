import { describe, expect, it } from "vitest";
import { exchangeSlackCode, SlackLoginError, slackAuthorizeUrl } from "./slack-oidc.ts";

const NOW = Date.parse("2026-11-07T15:00:00Z");
const cfg = { clientId: "cid.123", clientSecret: "csec", redirectUri: "https://painel/api/sessao/slack/retorno" };
const jwt = (claims: Record<string, unknown>) => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");
const good = { iss: "https://slack.com", aud: "cid.123", exp: NOW / 1000 + 300, nonce: "n1", sub: "UFER", "https://slack.com/user_id": "UFER", "https://slack.com/team_id": "T-DEMO", name: "Fernando" };

function fake(claims: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  let sent = "";
  const fetch = async (_u: string, init: RequestInit) => {
    sent = String(init.body);
    return Response.json(claims ? { ok: true, id_token: jwt(claims), ...extra } : { ok: false, error: "invalid_code" });
  };
  return { fetch, sent: () => sent };
}

describe("slackAuthorizeUrl", () => {
  it("pede só openid, com state, nonce e o espaço da empresa", () => {
    const u = new URL(slackAuthorizeUrl(cfg, { state: "s1", nonce: "n1", team: "T-DEMO" }));
    expect(u.origin + u.pathname).toBe("https://slack.com/openid/connect/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({ response_type: "code", scope: "openid", client_id: "cid.123", redirect_uri: cfg.redirectUri, state: "s1", nonce: "n1", team: "T-DEMO" });
  });
});

describe("exchangeSlackCode", () => {
  it("troca o código e devolve pessoa e espaço", async () => {
    const f = fake(good);
    expect(await exchangeSlackCode({ ...cfg, fetch: f.fetch }, "code-1", "n1", NOW)).toEqual({ userId: "UFER", teamId: "T-DEMO", name: "Fernando" });
    expect(f.sent()).toContain("code=code-1");
    expect(f.sent()).toContain("client_secret=csec");
  });

  it.each([
    ["código recusado", null, /recusou/],
    ["outro app", { ...good, aud: "outro" }, /outro app/],
    ["emissor falso", { ...good, iss: "https://evil.example" }, /emissor/],
    ["vencido", { ...good, exp: NOW / 1000 - 1 }, /vencido/],
    ["nonce trocado (reuso de login)", { ...good, nonce: "n2" }, /nonce/],
    ["sem espaço", { ...good, "https://slack.com/team_id": undefined }, /espaço/],
  ])("recusa: %s", async (_n, claims, msg) => {
    await expect(exchangeSlackCode({ ...cfg, fetch: fake(claims as Record<string, unknown> | null).fetch }, "c", "n1", NOW)).rejects.toThrow(msg);
    await expect(exchangeSlackCode({ ...cfg, fetch: fake(claims as Record<string, unknown> | null).fetch }, "c", "n1", NOW)).rejects.toBeInstanceOf(SlackLoginError);
  });
});
