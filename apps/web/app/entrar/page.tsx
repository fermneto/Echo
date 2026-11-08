import { demoMode } from "@/lib/session";
import { LOGIN_ERRORS, slackLoginConfig } from "@/lib/slack-login";
import { Logo } from "@/components/Logo";
import { SLACK_PATH } from "@/components/landing/integrations";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar · Echo" };

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const demo = demoMode();
  const slack = slackLoginConfig() !== null;
  const { erro } = await searchParams;
  return (
    <main className="entrar">
      <Logo />
      <h1 className="entrar__title">Entrar no Echo</h1>
      {erro && LOGIN_ERRORS[erro] ? (
        <p className="lead" role="alert">
          {LOGIN_ERRORS[erro]}
        </p>
      ) : null}
      {demo ? (
        <>
          <p className="lead">Entre com seu usuário e sua senha. Cada pessoa vê só o que o papel dela permite.</p>
          <LoginForm />
          <p className="entrar__or" aria-hidden="true">
            <span>ou</span>
          </p>
          <a className="button-outline entrar__slack-alt" href="/api/sessao/slack">
            <svg className="entrar__slack-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d={SLACK_PATH} fill="currentColor" />
            </svg>
            Entrar com o Slack
          </a>
        </>
      ) : slack ? (
        <a className="button-pill entrar__slack" href="/api/sessao/slack">
          <svg className="entrar__slack-logo" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d={SLACK_PATH} fill="currentColor" />
          </svg>
          Entrar com o Slack
        </a>
      ) : (
        <p className="lead">O login com o Slack ainda não está configurado neste ambiente.</p>
      )}
    </main>
  );
}
