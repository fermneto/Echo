import { PERSONAS } from "@/lib/demo/personas";
import { demoMode } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { PixelAvatar } from "@/components/PixelAvatar";
import { entrarComo } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar · Echo" };

const ROLE_LABEL = { member: "Equipe", leader: "Líder", hr: "RH" } as const;
const REAL = new Set(["fernando", "eduardo", "yan"]);

export default function EntrarPage() {
  const demo = demoMode();
  return (
    <main className="entrar">
      <Logo />
      <h1 className="entrar__title">Entrar no Echo</h1>
      {demo ? (
        <>
          <p className="lead">Ambiente de demonstração. Escolha quem você quer ser e veja o que essa pessoa pode acessar.</p>
          <button type="button" className="button-pill entrar__slack is-disabled" disabled title="O login com o Slack chega na etapa 15">
            Entrar com o Slack · em breve
          </button>
          <form action={entrarComo} className="entrar__form">
            <fieldset className="persona-list">
              <legend className="sr-only">Persona</legend>
              {PERSONAS.map((p, i) => (
                <label key={p.id} className="persona-row">
                  <input type="radio" name="persona" value={p.id} defaultChecked={i === 0} aria-label={`${p.name}, ${ROLE_LABEL[p.role]}`} aria-describedby={`story-${p.id}`} />
                  <PixelAvatar persona={p} size={40} decorative />
                  <span className="persona-row__text">
                    <span className="persona-row__name">{p.name}</span>
                    <span className="persona-row__role mono">
                      {ROLE_LABEL[p.role]}
                      {REAL.has(p.id) ? "" : " · persona simulada"}
                    </span>
                  </span>
                  <span className="persona-row__story" id={`story-${p.id}`}>
                    {p.story}
                  </span>
                </label>
              ))}
            </fieldset>
            <button type="submit" className="button-pill entrar__submit">
              Entrar
            </button>
          </form>
          <p className="mono muted entrar__note">Dados sintéticos. Só Fernando, Eduardo e Yan são pessoas reais.</p>
        </>
      ) : (
        <p className="lead">O login com o Slack ainda não está disponível neste ambiente.</p>
      )}
    </main>
  );
}
