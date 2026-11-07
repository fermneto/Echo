import { slackAuthorizeUrl } from "@echo/connectors";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cookieOptions, newLoginAttempt, OIDC_COOKIE } from "@/lib/auth";
import { slackLoginConfig } from "@/lib/slack-login";

export const dynamic = "force-dynamic";

/** Começa o login: guarda state e nonce num cookie curto e manda o navegador ao Slack. */
export async function GET(): Promise<Response> {
  const cfg = slackLoginConfig();
  if (!cfg) redirect("/entrar?erro=nao_configurado");
  const attempt = newLoginAttempt(cfg.sessionSecret);
  (await cookies()).set(OIDC_COOKIE, attempt.cookie, cookieOptions(600));
  redirect(slackAuthorizeUrl(cfg, { state: attempt.state, nonce: attempt.nonce, ...(cfg.team ? { team: cfg.team } : {}) }));
}
