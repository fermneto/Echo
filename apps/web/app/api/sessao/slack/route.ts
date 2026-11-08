import { slackAuthorizeUrl } from "@echo/connectors";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { cookieOptions, newLoginAttempt, OIDC_COOKIE, RETURN_COOKIE, safeReturnPath } from "@/lib/auth";
import { slackLoginConfig } from "@/lib/slack-login";

export const dynamic = "force-dynamic";

/** Começa o login: guarda state e nonce num cookie curto (e a página de volta) e manda o navegador ao Slack. */
export async function GET(req: NextRequest): Promise<Response> {
  const cfg = slackLoginConfig();
  if (!cfg) redirect("/entrar?erro=nao_configurado");
  const attempt = newLoginAttempt(cfg.sessionSecret);
  const jar = await cookies();
  jar.set(OIDC_COOKIE, attempt.cookie, cookieOptions(600));
  const back = safeReturnPath(req.nextUrl.searchParams.get("voltar"));
  if (back) jar.set(RETURN_COOKIE, back, cookieOptions(600));
  else jar.delete(RETURN_COOKIE);
  redirect(slackAuthorizeUrl(cfg, { state: attempt.state, nonce: attempt.nonce, ...(cfg.team ? { team: cfg.team } : {}) }));
}
