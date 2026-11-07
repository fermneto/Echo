import Link from "next/link";
import { canAskTwin } from "@/lib/access";
import { statusLine, toneOf } from "@/lib/people";
import { requireAccess } from "@/lib/session";
import { loadTeam } from "@/lib/team-live";
import { localTime } from "@/lib/time";
import { PixelAvatar } from "@/components/PixelAvatar";
import { SearchFilter } from "@/components/SearchFilter";

export const metadata = { title: "Pessoas · Echo" };

export default async function EquipePage() {
  const me = await requireAccess("equipe");
  const now = new Date();
  const team = await loadTeam(now);
  const seesWork = canAskTwin(me.role);
  const zones = new Set(team.map((p) => p.timezone)).size;
  return (
    <>
      <h1 className="hero-title hero-title--page">Pessoas</h1>
      <p className="lead">
        {team.length} pessoas em {zones} fusos. Abra a ficha para ver a disponibilidade{seesWork ? " e perguntar ao gêmeo" : ""}.
      </p>
      <SearchFilter label="Buscar pessoas" placeholder="Buscar por nome, função, cidade ou estado" empty="Ninguém encontrado com essa busca.">
      <ul className="people-list" role="list">
        {team.map((p) => (
          <li key={p.id} className="people-row" data-search={`${p.name} ${p.title} ${p.city} ${p.cityCode} ${statusLine(p)}`}>
            <PixelAvatar persona={p} size={40} />
            <div className="people-row__who">
              <p className="people-row__name">
                {p.name}
                {p.id === me.id && <span className="tag mono">você</span>}
              </p>
              <p className="people-row__title">{p.title}</p>
            </div>
            <div className="people-row__cell people-row__cell--now">
              <span className="people-row__k mono">Agora</span>
              <span className="people-row__v">
                <span className={`dot dot--${toneOf(p)}`} aria-hidden="true" /> {statusLine(p)}
              </span>
            </div>
            <div className="people-row__cell people-row__cell--time">
              <span className="people-row__k mono">Hora local</span>
              <span className="people-row__v mono">
                {p.cityCode} {localTime(now, p.timezone)}
              </span>
            </div>
            <div className="people-row__actions">
              <Link href={`/pessoas/${p.id}`} className="button-outline">
                Ver ficha
              </Link>
              {seesWork && p.id !== me.id && (
                <Link href={`/pessoas/${p.id}#perguntar`} className="text-link">
                  Perguntar ao gêmeo
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
      </SearchFilter>
    </>
  );
}
