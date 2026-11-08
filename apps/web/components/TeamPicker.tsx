import { acompanharEquipes } from "@/app/(painel)/equipes-actions";
import type { TeamScope } from "@/lib/scope";

/** Só o RH: escolhe quais equipes acompanhar. A escolha vale para o mapa, Pessoas e as fichas. */
export function TeamPicker({ scope, back }: { scope: TeamScope; back: string }) {
  if (!scope.canChoose) return null;
  return (
    <form action={acompanharEquipes} className="team-picker" aria-label="Equipes que você acompanha">
      <input type="hidden" name="voltar" value={back} />
      <span className="team-picker__label label-caps">Equipes que você acompanha</span>
      <ul className="team-picker__list" role="list">
        {scope.teams.map((t) => (
          <li key={t.id}>
            <label className="team-picker__item">
              <input type="checkbox" name="equipe" value={t.id} defaultChecked={scope.visible.includes(t.id)} /> {t.name}
            </label>
          </li>
        ))}
      </ul>
      <button type="submit" className="button-outline">
        Acompanhar
      </button>
    </form>
  );
}
