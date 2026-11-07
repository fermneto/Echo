import Link from "next/link";
import { canSee, ROUTES, type RouteId } from "@/lib/access";
import { PERSONAS } from "@/lib/demo/personas";
import { demoMode, requireAccess } from "@/lib/session";
import { PersonCard } from "@/components/PersonCard";

const SHORTCUTS: readonly RouteId[] = ["plano", "notaDoDia", "notas", "redistribuicao", "relatorios", "execucoes", "ganhos", "configuracao", "simulador"];

export default async function InicioPage() {
  const me = await requireAccess("inicio");
  const demo = demoMode();
  const shortcuts = SHORTCUTS.filter((r) => canSee(me.role, r, { demo }));

  return (
    <>
      <h1 className="app-title">Olá, {me.name}</h1>
      <p className="lead">Quem está trabalhando agora, quem está com o agente e o que espera por você.</p>

      <section className="section">
        <h2 className="label-caps section__title">Equipe</h2>
        <div className="team-grid">
          {PERSONAS.map((p) => (
            <PersonCard key={p.id} persona={p} />
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="label-caps section__title">Atalhos</h2>
        <ul className="module shortcut-list" role="list">
          {shortcuts.map((r) => (
            <li key={r}>
              <Link href={ROUTES[r].href} className="shortcut">
                {ROUTES[r].label}
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
