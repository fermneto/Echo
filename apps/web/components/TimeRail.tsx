import Link from "next/link";
import type { Persona } from "@/lib/demo/types";
import { railFor, type RailState } from "@/lib/schedule";
import { localTime } from "@/lib/time";
import { PixelAvatar } from "./PixelAvatar";

const STATE_LABEL: Record<RailState, string> = { on: "no expediente", twin: "com o agente", wait: "em férias" };

/** Linha do tempo de uma pessoa: o expediente da pessoa nas 12h antes e depois de agora. */
export function RailTrack({ persona, now }: { persona: Persona; now: Date }) {
  const rail = railFor(persona, now);
  const current = rail.segments[rail.nowIndex]?.state ?? "twin";
  return (
    <div className="rail-track" role="img" aria-label={`${persona.name}: ${STATE_LABEL[current]} agora`}>
      {rail.segments.map((s, i) => (
        <span key={i} className={`rail-seg rail-seg--${s.state}${s.past ? " is-past" : ""}`} />
      ))}
      <span className="rail-needle" style={{ left: `${(rail.nowIndex / rail.segments.length) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

/** Fusos da equipe: uma linha do tempo por pessoa, com a hora local de cada uma. */
export function TimeRail({ people, now }: { people: readonly Persona[]; now: Date }) {
  return (
    <div className="rail">
      <div className="rail__axis mono" aria-hidden="true">
        <span />
        <span className="rail__ticks">
          {["−12h", "−6h", "agora", "+6h", "+12h"].map((t, i) => (
            <span key={t} className={t === "agora" ? "rail__now" : undefined} style={{ left: `${i * 25}%` }}>
              {t}
            </span>
          ))}
        </span>
        <span />
      </div>
      <ul className="rail__rows" role="list">
        {people.map((p) => (
          <li key={p.id} className="rail__row">
            <Link href={`/pessoas/${p.id}`} className="rail__who">
              <PixelAvatar persona={p} size={28} />
              <span className="rail__name">{p.name}</span>
            </Link>
            <RailTrack persona={p} now={now} />
            <span className="rail__time mono">
              <span className="muted">{p.cityCode}</span> {localTime(now, p.timezone)}
            </span>
          </li>
        ))}
      </ul>
      <p className="rail__legend mono">
        <span>
          <span className="dot dot--on" aria-hidden="true" /> no expediente
        </span>
        <span>
          <span className="dot dot--twin" aria-hidden="true" /> com o agente
        </span>
        <span>
          <span className="dot dot--wait" aria-hidden="true" /> férias
        </span>
      </p>
    </div>
  );
}
