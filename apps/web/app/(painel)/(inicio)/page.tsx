import Link from "next/link";
import { canAskTwin } from "@/lib/access";
import { ECHO_GENERIC_SUGGESTIONS, ECHO_SUGGESTIONS } from "@/lib/demo/echo";
import { WAITING } from "@/lib/demo/feed";
import { scopeLabel, teamScope } from "@/lib/scope";
import { TeamPicker } from "@/components/TeamPicker";
import { lookFor } from "@/lib/demo/looks";
import type { Persona } from "@/lib/demo/types";
import { currentDecisions } from "@/lib/decisions-store";
import { isDemoOrg } from "@/lib/gains";
import { loadWaiting } from "@/lib/pending-live";
import { pendingPlans } from "@/lib/redistribution-server";
import { holderLine, statusLine, toneOf } from "@/lib/people";
import { requireAccess } from "@/lib/session";
import { AWAY_MAX } from "@/lib/away-log";
import { loadAwayRows } from "@/lib/away-live";
import { countsOf, loadTeam } from "@/lib/team-live";
import { localTime } from "@/lib/time";
import { AskPanel } from "@/components/AskPanel";
import { WaitingStrip } from "@/components/WaitingStrip";
import { PixelAvatar } from "@/components/PixelAvatar";
import { WorldMap, type MapArc, type MapCrew, type MapZone } from "@/components/WorldMap";
import { perguntarEcho } from "../actions";
import "../inicio.css";

export const metadata = { title: "Início · Echo" };

/** "GMT-3" → -3; "GMT+5:30" → 5.5. Só exibição: a hora local vem do Intl. */
function utcOffset(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3] ?? 0) / 60);
}

function buildMap(team: readonly Persona[], now: Date) {
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
      people: people.map((p) => ({
        id: p.id,
        name: p.name,
        title: p.title,
        city: p.city,
        time: localTime(now, p.timezone),
        status: statusLine(p),
        holder: holderLine(p),
        tone: toneOf(p),
        mode: toneOf(p) === "on" ? "person" : toneOf(p) === "twin" ? "twin" : "away",
        look: p.avatar ?? lookFor(p.id),
      })),
    };
  });

  const offsets = new Map<number, string>();
  for (const p of team) {
    const off = utcOffset(p.timezone, now);
    if (!offsets.has(off)) offsets.set(off, `UTC${off >= 0 ? "+" : "−"}${String(Math.abs(off)).replace(".5", ":30")} · ${localTime(now, p.timezone)}`);
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
  // Quem está no expediente fica ligado entre si, do oeste para o leste.
  const east = [...working].sort((a, b) => a.location[1] - b.location[1]);
  for (let i = 1; i < east.length; i++) arcs.push({ from: east[i - 1]!.key, to: east[i]!.key, tone: "on" });

  return { crews, zones, arcs };
}

export default async function InicioPage() {
  const me = await requireAccess("inicio");
  const now = new Date();
  const seesWork = canAskTwin(me.role);
  const demo = isDemoOrg(me.orgId);
  // O que não depende da equipe é lido junto com ela; só o resumo da ausência precisa do expediente vindo do banco.
  const [loaded, decisions, plans, live] = await Promise.all([
    loadTeam(now, { orgId: me.orgId }),
    currentDecisions(),
    seesWork ? pendingPlans(me, now) : null,
    seesWork && !demo ? loadWaiting(me, now) : [],
  ]);
  const scope = await teamScope(me, loaded);
  const team = scope.people;
  const counts = countsOf(team);
  // O RH nunca lê perguntas: a seção do que o agente fez não aparece para ele.
  const seesAway = me.role !== "hr";
  // Expediente e fuso do banco, quando houver: a janela começa no fim do último expediente registrado.
  const meLive = team.find((p) => p.id === me.id) ?? me;
  // Com banco, o plano de ausência vem dos planos esperando esta liderança, não da demonstração.
  // Quem é de empresa conectada vê só as pendências do banco; a persona da demonstração, também as da história.
  const away = seesAway ? await loadAwayRows(meLive, now) : null;
  const waiting = [
    ...(plans ?? []).map((p) => ({
      id: "Plano",
      key: p.id,
      text: p.title,
      since: p.since,
      detail: "Montado por regra a partir da ausência, respeitando áreas e carga. Nada muda no Linear nem no GitHub até você aprovar.",
      action: { label: "Revisar o plano", href: "/redistribuicao" },
    })),
    ...live,
    ...(demo ? WAITING.filter((w) => w.ownerId === me.id && !(w.decisionId && w.decisionId in decisions) && !(plans && w.decisionId === "ferias-bruno")).map((w) => ({ ...w, key: w.id })) : []),
  ];
  const { crews, zones, arcs } = buildMap(team, now);

  return (
    <>
      <p className="live-strip mono">
        <span className="dot dot--on" aria-hidden="true" />
        Agora · {counts.on} no expediente · {counts.away} gêmeos cobrindo · {zones.length} fusos
      </p>
      <h1 className="hero-title">{counts.on > 0 ? "Quem está trabalhando agora" : "Ninguém no expediente agora"}</h1>
      <p className="muted">Você vê {scopeLabel(scope)}.</p>
      <TeamPicker scope={scope} back="/" />

      <ul className="crew-grid" role="list" aria-label="Equipe">
        {team.map((p) => (
          <li key={p.id}>
            <Link href={`/pessoas/${p.id}`} className="crew-tile">
              <PixelAvatar persona={p} size={64} />
              <span className="crew-tile__name">{p.name}</span>
              <span className="crew-tile__time mono">{localTime(now, p.timezone)}</span>
            </Link>
          </li>
        ))}
      </ul>

      {seesWork && (
        <WaitingStrip items={waiting} />
      )}

      {away && (
        <section className="away-log" aria-labelledby="enquanto-fora">
          <header className="away-log__head">
            <h2 id="enquanto-fora" className="away-log__title mono">
              Enquanto você estava fora
            </h2>
            <span className="away-log__agent mono">
              Agente de {me.name}
              {away.since ? ` · desde ${localTime(away.since, meLive.timezone)}` : ""}
            </span>
          </header>
          {away.rows.length > 0 ? (
            <>
              <ul className="away-log__list" role="list">
                {away.rows.slice(0, AWAY_MAX).map((r) => (
                  <li key={r.key} className="away-log__row">
                    <span className="away-log__time mono">{r.time}</span>
                    <span className={`dot dot--${r.tone === "wait" ? "wait" : "twin"}`} aria-hidden="true" />
                    <p className="away-log__text">
                      {r.text}
                      {r.ref && <span className="away-log__ref mono">{r.ref}</span>}
                    </p>
                  </li>
                ))}
              </ul>
              {away.rows.length > AWAY_MAX && <p className="away-log__more muted mono">e mais {away.rows.length - AWAY_MAX}</p>}
            </>
          ) : (
            <p className="away-log__empty muted">Ninguém precisou do seu agente desde o fim do seu expediente.</p>
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
            suggestions={demo ? ECHO_SUGGESTIONS : ECHO_GENERIC_SUGGESTIONS}
          />
        </section>
      )}

      <section className="section section--bleed" aria-labelledby="mapa">
        <h2 id="mapa" className="label-caps section__title">
          A equipe pelo mundo
        </h2>
        <WorldMap crews={crews} zones={zones} arcs={arcs} nowIso={now.toISOString()} canAsk={seesWork} />
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

      <p className="home-more">
        <Link href="/equipe" className="text-link">
          Ver todas as {team.length} pessoas, com estado e hora local
        </Link>
      </p>
    </>
  );
}
