import { PERSONAS } from "@/lib/demo/personas";
import { demoMode } from "@/lib/session";
import { LOGIN_ERRORS, slackLoginConfig } from "@/lib/slack-login";
import { Logo } from "@/components/Logo";
import { PixelAvatar } from "@/components/PixelAvatar";
import { entrarComo } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar · Echo" };

const ROLE_LABEL = { member: "Equipe", leader: "Líder", hr: "RH" } as const;

export default async function EntrarPage({ searchParams }: { searchParams: Promise<{ erro?: string; persona?: string }> }) {
  const demo = demoMode();
  const slack = slackLoginConfig() !== null;
  const { erro, persona: wanted } = await searchParams;
  const preselected = PERSONAS.some((p) => p.id === wanted) ? wanted : PERSONAS[0]?.id;
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
          <p className="lead">Escolha com quem entrar. Cada pessoa vê só o que o papel dela permite.</p>
          {slack && (
            <a className="button-pill entrar__slack" href="/api/sessao/slack">
              Entrar com o Slack
            </a>
          )}
          <form action={entrarComo} className="entrar__form">
            <fieldset className="persona-list">
              <legend className="sr-only">Persona</legend>
              {PERSONAS.map((p) => (
                <label key={p.id} className="persona-row">
                  <input type="radio" name="persona" value={p.id} defaultChecked={p.id === preselected} aria-label={`${p.name}, ${ROLE_LABEL[p.role]}`} aria-describedby={`story-${p.id}`} />
                  <PixelAvatar persona={p} size={40} decorative />
                  <span className="persona-row__text">
                    <span className="persona-row__name">{p.name}</span>
                    <span className="persona-row__role mono">
                      {ROLE_LABEL[p.role]}
                    </span>
                  </span>
                  <span className="persona-row__story" id={`story-${p.id}`}>
                    {p.title} · {p.city}
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="button-pill entrar__submit">
              Entrar
            </button>
          </form>
        </>
      ) : slack ? (
        <a className="button-pill entrar__slack" href="/api/sessao/slack">
          Entrar com o Slack
        </a>
      ) : (
        <p className="lead">O login com o Slack ainda não está configurado neste ambiente.</p>
      )}
    </main>
  );
}
