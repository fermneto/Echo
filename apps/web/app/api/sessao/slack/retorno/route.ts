import { exchangeSlackCode, resolvePanelPerson, SlackLoginError } from "@echo/connectors";
import { auditLog, withOrg } from "@echo/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { cookieOptions, OIDC_COOKIE, readLoginAttempt, RETURN_COOKIE, safeReturnPath, SESSION_COOKIE, SESSION_TTL_S, signSession } from "@/lib/auth";
import { PERSONA_COOKIE } from "@/lib/session";
import { panelDb } from "@/lib/db";
import { slackLoginConfig } from "@/lib/slack-login";

export const dynamic = "force-dynamic";

/** Volta do Slack: confere state e nonce, troca o código, acha a pessoa e abre a sessão de 12 horas. */
export async function GET(req: NextRequest): Promise<Response> {
  const cfg = slackLoginConfig();
  const db = panelDb();
  if (!cfg || !db) redirect("/entrar?erro=nao_configurado");
  const jar = await cookies();
  const attempt = readLoginAttempt(cfg.sessionSecret, jar.get(OIDC_COOKIE)?.value);
  jar.delete(OIDC_COOKIE);
  const back = safeReturnPath(jar.get(RETURN_COOKIE)?.value) ?? "/dashboard";
  jar.delete(RETURN_COOKIE);
  const q = req.nextUrl.searchParams;
  if (q.get("error")) redirect("/entrar?erro=cancelado");
  const code = q.get("code");
  if (!attempt || !code || q.get("state") !== attempt.state) redirect("/entrar?erro=tentativa_invalida");

  let reason = "";
  try {
    const identity = await exchangeSlackCode(cfg, code, attempt.nonce);
    const login = await resolvePanelPerson(db, identity);
    if (login.ok) {
      const { orgId, personId, role } = login.person;
      jar.set(SESSION_COOKIE, signSession(cfg.sessionSecret, { orgId, personId, role }), cookieOptions(SESSION_TTL_S));
      // Vale o último login: a persona da demonstração (que tem prioridade) sai, e o painel passa a ser da pessoa real.
      jar.delete(PERSONA_COOKIE);
      await withOrg(db, orgId, (tx) => tx.insert(auditLog).values({ orgId, actor: `person:${personId}`, action: "login:slack", target: `person:${personId}` }));
    } else {
      reason = login.reason;
    }
  } catch (err) {
    if (!(err instanceof SlackLoginError)) throw err;
    reason = "slack_recusou";
  }
  redirect(reason ? `/entrar?erro=${reason}` : back);
}
