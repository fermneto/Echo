import Link from "next/link";
import { canAskTwin } from "@/lib/access";
import { ECHO_SUGGESTIONS } from "@/lib/demo/echo";
import { WAITING } from "@/lib/demo/feed";
import { DEMO_NOW } from "@/lib/demo/personas";
import { teamCounts, TEAM } from "@/lib/demo/team";
import type { Persona } from "@/lib/demo/types";
import { requireAccess } from "@/lib/session";
import { localTime } from "@/lib/time";
import { AskPanel } from "@/components/AskPanel";
import { PixelAvatar } from "@/components/PixelAvatar";
import { WorldMap, type MapArc, type MapCrew, type MapZone } from "@/components/WorldMap";
import { perguntarEcho } from "./actions";

/** "GMT-3" → -3; "GMT+5:30" → 5.5. Só exibição: a hora local vem do Intl. */
function utcOffset(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60);
}

const toneOf = (p: Persona) => (p.availability.kind === "working" ? "on" : p.availability.kind === "off" ? "twin" : "wait");

function statusLine(p: Persona): string {
  const a = p.availability;
  if (a.kind === "working") return "No expediente";
  if (a.kind === "vacation") return `De férias até ${a.until}`;
  return `Fora, volta ${a.returns.replace(/, horário de .*/, "")}`;
}

function buildMap(team: readonly Persona[]) {
  const byCity = new Map<string, Persona[]>();
  for (const p of team) if (p.location) byCity.set(p.cityCode, [...(byCity.get(p.cityCode) ?? []), p]);

  const crews: MapCrew[] = [...byCity.entries()].map(([code, people]) => {
    const tone = people.some((p) => p.availability.kind === "working") ? "on" : people.some((p) => p.availability.kind === "off") ? "twin" : "wait";
    const names = people.map((p) => p.name.toUpperCase());
    return {
      key: code,
      location: people[0]!.location!,
      tone,
      label: names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", "),
      people: people.map((p) => ({ id: p.id, mode: toneOf(p) === "on" ? "person" : toneOf(p) === "twin" ? "twin" : "away", hair: p.hair ?? "short" })),
    };
  });

  const offsets = new Map<number, string>();
  for (const p of team) {
    const off = utcOffset(p.timezone, DEMO_NOW);
    if (!offsets.has(off)) offsets.set(off, `UTC${off >= 0 ? "+" : "−"}${String(Math.abs(off)).replace(".5", ":30")} · ${localTime(DEMO_NOW, p.timezone)}`);
  }
  const zones: MapZone[] = [...offsets.entries()].sort((a, b) => a[0] - b[0]).map(([off, label]) => ({ lng: off * 15, label }));

  // Cada gêmeo ligado ao grupo no expediente mais próximo; e quem trabalha, ligado entre si.
  const working = crews.filter((c) => c.tone === "on");
  const arcs: MapArc[] = [];
  for (const c of crews) {
    if (c.tone === "on") continue;
    const near = [...working].sort((a, b) => Math.abs(a.location[1] - c.location[1]) - Math.abs(b.location[1] - c.location[1]))[0];
    if (near) arcs.push({ from: near.key, to: c.key, tone: "twin" });
  }
  if (byCity.has("JNB") && byCity.has("TYO")) arcs.push({ from: "JNB", to: "TYO", tone: "on" });

  return { crews, zones, arcs };
}

export default async function InicioPage() {
  const me = await requireAccess("inicio");
  const counts = teamCounts();
  const seesWork = canAskTwin(me.role);
  const waiting = WAITING.filter((w) => w.ownerId === me.id);
  const focus = TEAM.find((p) => p.id === "fernando")!;
  const { crews, zones, arcs } = buildMap(TEAM);

  return (
    <>
      <p className="live-strip mono">
        <span className="dot dot--on" aria-hidden="true" />
        Agora · {counts.on} no expediente · {counts.away} gêmeos cobrindo · {counts.zones} fusos
      </p>
      <h1 className="hero-title">Quem está trabalhando agora</h1>
      <p className="lead">
        {focus.name} está fora em {focus.city}, {localTime(DEMO_NOW, focus.timezone)}. O gêmeo de {focus.name} responde enquanto isso.
      </p>

      <ul className="crew-grid" role="list" aria-label="Equipe">
        {TEAM.map((p) => (
          <li key={p.id}>
            <Link href={`/pessoas/${p.id}`} className="crew-tile">
              <PixelAvatar persona={p} size={64} />
              <span className="crew-tile__name">{p.name}</span>
              <span className="crew-tile__time mono">{localTime(DEMO_NOW, p.timezone)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {seesWork && (
        <section className="waiting-strip" aria-label="Aguardando você">
          <span className="waiting-strip__label mono">
            <span className="dot dot--wait" aria-hidden="true" />
            Aguardando você
          </span>
          {waiting.length > 0 ? (
            <ul className="waiting-strip__list" role="list">
              {waiting.map((w) => (
                <li key={w.id} className="waiting-chip">
                  <span className="waiting-chip__title">{w.text}</span>
                  <span className="waiting-chip__meta mono">
                    {w.id} · {w.since}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted waiting-strip__empty">Nada esperando você agora.</p>
          )}
        </section>
      )}

      {seesWork && (
        <section className="section">
          <AskPanel
            ask={perguntarEcho}
            title="Pergunte ao Echo"
            footer="Perguntas sobre a equipe e o trabalho. O Echo consulta os registros, cita a fonte e não fala por ninguém."
            agent="Echo"
            askerName={me.name}
            empty="Por exemplo: quem está no expediente agora, o que está pendente ou quem sabe de um tema."
            placeholder="Por exemplo: alguém deixou algo pendente?"
            suggestions={ECHO_SUGGESTIONS}
          />
        </section>
      )}

      <section className="section section--bleed" aria-labelledby="mapa">
        <h2 id="mapa" className="label-caps section__title">
          A equipe pelo mundo
        </h2>
        <WorldMap crews={crews} zones={zones} arcs={arcs} nowIso={DEMO_NOW.toISOString()} />
        <p className="wmap-legend mono">
          <span>
            <span className="dot dot--on" aria-hidden="true" /> no expediente
          </span>
          <span>
            <span className="dot dot--twin" aria-hidden="true" /> gêmeo cobrindo
          </span>
          <span>
            <span className="dot dot--wait" aria-hidden="true" /> de férias
          </span>
          <span className="muted">Linhas: do gêmeo até quem está trabalhando · lado apagado: onde é noite agora</span>
        </p>
      </section>

      <section className="section" aria-labelledby="pessoas">
        <h2 id="pessoas" className="label-caps section__title">
          Pessoas
        </h2>
        <ul className="people-list" role="list">
          {TEAM.map((p) => (
            <li key={p.id} className="people-row">
              <PixelAvatar persona={p} size={40} />
              <div className="people-row__who">
                <p className="people-row__name">
                  {p.name}
                  {p.id === me.id ? <span className="tag mono">você</span> : p.simulated ? <span className="tag mono">persona simulada</span> : null}
                </p>
                <p className="people-row__title">{p.title}</p>
              </div>
              <div className="people-row__cell">
                <span className="people-row__k mono">Agora</span>
                <span className="people-row__v">
                  <span className={`dot dot--${toneOf(p) === "on" ? "on" : toneOf(p) === "twin" ? "twin" : "wait"}`} aria-hidden="true" /> {statusLine(p)}
                </span>
              </div>
              <div className="people-row__cell">
                <span className="people-row__k mono">Hora local</span>
                <span className="people-row__v mono">
                  {p.cityCode} {localTime(DEMO_NOW, p.timezone)}
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
      </section>
    </>
  );
}
