// Login no painel com o Slack ("Sign in with Slack", OpenID Connect, fluxo de código).
// O id_token vem direto do endpoint de token do Slack, por TLS e com o client_secret; conferimos
// emissor, público, validade e nonce. Quem é a pessoa no Echo sai da tabela identities.
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SlackOidcConfig {
  clientId: string;
  clientSecret: string;
  /** https://<painel>/api/sessao/slack/retorno — igual ao cadastrado no app do Slack. */
  redirectUri: string;
  fetch?: FetchLike;
}

export interface SlackIdentity {
  userId: string;
  teamId: string;
  name?: string;
}

export class SlackLoginError extends Error {
  override name = "SlackLoginError";
}

/** Endereço para onde o navegador vai. `team` restringe ao espaço da empresa, quando conhecido. */
export function slackAuthorizeUrl(cfg: Pick<SlackOidcConfig, "clientId" | "redirectUri">, p: { state: string; nonce: string; team?: string }): string {
  const q = new URLSearchParams({ response_type: "code", scope: "openid", client_id: cfg.clientId, redirect_uri: cfg.redirectUri, state: p.state, nonce: p.nonce });
  if (p.team) q.set("team", p.team);
  return `https://slack.com/openid/connect/authorize?${q}`;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1];
  if (!part) throw new SlackLoginError("id_token malformado");
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new SlackLoginError("id_token malformado");
  }
}

/** Troca o código pelo id_token e confere as alegações. */
export async function exchangeSlackCode(cfg: SlackOidcConfig, code: string, expectedNonce: string, nowMs = Date.now()): Promise<SlackIdentity> {
  const f = cfg.fetch ?? ((u, i) => fetch(u, i));
  const res = await f("https://slack.com/api/openid.connect.token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; id_token?: string };
  if (!res.ok || !body.ok || !body.id_token) throw new SlackLoginError(`Slack recusou o código: ${body.error ?? res.status}`);
  const c = decodeJwtPayload(body.id_token);
  if (c.iss !== "https://slack.com") throw new SlackLoginError("emissor inesperado");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(cfg.clientId)) throw new SlackLoginError("token emitido para outro app");
  if (typeof c.exp !== "number" || c.exp * 1000 < nowMs) throw new SlackLoginError("token vencido");
  if (c.nonce !== expectedNonce) throw new SlackLoginError("nonce não confere");
  const userId = (c["https://slack.com/user_id"] ?? c.sub) as string | undefined;
  const teamId = c["https://slack.com/team_id"] as string | undefined;
  if (!userId || !teamId) throw new SlackLoginError("token sem pessoa ou espaço");
  return { userId, teamId, ...(typeof c.name === "string" ? { name: c.name } : {}) };
}
