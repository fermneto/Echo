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

/** "Produto", "Produto e Dados e plataforma"… para dizer de quem é o recorte. */
export function scopeLabel(scope: TeamScope): string {
  const names = scope.teams.filter((t) => scope.visible.includes(t.id)).map((t) => t.name);
  if (names.length === scope.teams.length) return "todas as equipes";
  if (names.length === 0) return "nenhuma equipe";
  return names.length === 1 ? `equipe ${names[0]}` : `equipes ${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}
