import Link from "next/link";
import { canAskTwin } from "@/lib/access";
import { teamScope } from "@/lib/scope";
import { scopeLabel, TeamPicker } from "@/components/TeamPicker";
import { statusLine, toneOf } from "@/lib/people";
import { requireAccess } from "@/lib/session";
import { localTime } from "@/lib/time";
import { PixelAvatar } from "@/components/PixelAvatar";

export const metadata = { title: "Pessoas · Echo" };

export default async function EquipePage() {
  const me = await requireAccess("equipe");
  const now = new Date();
  const seesWork = canAskTwin(me.role);
  const scope = await teamScope(me);
  const TEAM = scope.people;
  const zones = new Set(TEAM.map((p) => p.timezone)).size;
  return (
    <>
      <h1 className="hero-title hero-title--page">Pessoas</h1>
      <p className="lead">
        {TEAM.length} pessoas em {zones} fusos, de {scopeLabel(scope)}. Abra a ficha para ver a disponibilidade{seesWork ? " e perguntar ao gêmeo" : ""}.
      </p>
      <TeamPicker scope={scope} back="/equipe" />
      <ul className="people-list" role="list">
        {TEAM.map((p) => (
          <li key={p.id} className="people-row">
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
    </>
  );
}
