import { PERSONAS } from "@/lib/demo/personas";
import { demoMode } from "@/lib/session";
import { Logo } from "@/components/Logo";
import { entrarComo } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Entrar · Echo" };

const ROLE_LABEL = { member: "Equipe", leader: "Liderança", hr: "RH" } as const;

export default function EntrarPage() {
  const demo = demoMode();
  return (
    <main className="entrar">
      <Logo />
      <h1 className="app-title">Entrar</h1>
      {demo ? (
        <>
          <p className="leader">Escolha uma persona da demonstração. Cada uma vê só o que o papel dela permite.</p>
          <form action={entrarComo} className="module persona-list">
            {PERSONAS.map((p) => (
              <button key={p.id} type="submit" name="persona" value={p.id} className="persona-row">
                <span className="avatar" aria-hidden="true">{p.name[0]}</span>
                <span className="persona-row__text">
                  <span className="persona-row__name">{p.name}</span>
                  <span className="persona-row__story">{p.story}</span>
                </span>
                <span className="mono persona-row__role">{ROLE_LABEL[p.role]}</span>
              </button>
            ))}
          </form>
          <p className="mono muted">DADOS SINTÉTICOS · RH SIMULADO</p>
        </>
      ) : (
        <p className="leader">O login com o Slack ainda não está disponível neste ambiente.</p>
      )}
    </main>
  );
}
