import Link from "next/link";
import { canAskTwin } from "@/lib/access";
import { NIGHT_LOG, WAITING } from "@/lib/demo/feed";
import { DEMO_NOW, findPersona, PERSONAS } from "@/lib/demo/personas";
import type { Persona } from "@/lib/demo/types";
import { requireAccess } from "@/lib/session";
import { localTime } from "@/lib/time";
import { PixelAvatar } from "@/components/PixelAvatar";
import { ProductWindow } from "@/components/ProductWindow";
import { TimeRail } from "@/components/TimeRail";

const CITIES = [...new Map(PERSONAS.map((p) => [p.cityCode, p.timezone])).entries()];

function names(list: Persona[]): string {
  const n = list.map((p) => p.name);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} e ${n.at(-1)}`;
}

/** A frase do agora, escrita a partir do estado de cada pessoa. */
function nowSentence(people: readonly Persona[]): string[] {
  const working = people.filter((p) => p.availability.kind === "working");
  const lines: string[] = [];
  if (working.length) lines.push(`${names(working)} ${working.length > 1 ? "estão" : "está"} no expediente.`);
  for (const p of people) {
    const a = p.availability;
    if (a.kind === "off") lines.push(`O agente de ${p.name} responde até ${p.name} voltar, ${a.returns}.`);
    if (a.kind === "vacation") lines.push(`${p.name} está de férias até ${a.until}, e o agente cobre.`);
  }
  return lines;
}

export default async function InicioPage() {
  const me = await requireAccess("inicio");
  const seesWork = canAskTwin(me.role);
  const waiting = WAITING.filter((w) => !w.leaderOnly || me.role === "leader");

  return (
    <>
      <div className="now-head">
        <h1 className="app-title">Agora</h1>
        <p className="now-clocks mono" aria-label="Hora local de cada cidade">
          {CITIES.map(([code, tz]) => (
            <span key={code}>
              <span className="muted">{code}</span> {localTime(DEMO_NOW, tz)}
            </span>
          ))}
        </p>
      </div>
      <p className="lead now-lead">{nowSentence(PERSONAS).join(" ")}</p>

      <ProductWindow title="Fusos da equipe" footer="Expedientes e ausências cadastrados. Ninguém é rastreado online.">
        <TimeRail people={PERSONAS} now={DEMO_NOW} />
      </ProductWindow>

      {seesWork && (
        <div className="now-grid">
          <section aria-labelledby="esperando">
            <h2 id="esperando" className="label-caps section__title">
              Esperando decisão
            </h2>
            <ul className="module waiting" role="list">
              {waiting.map((w) => {
                const owner = findPersona(w.ownerId);
                const mine = w.ownerId === me.id;
                return (
                  <li key={w.id} className={`waiting__item${mine ? " is-mine" : ""}`}>
                    <span className="dot dot--wait" aria-hidden="true" />
                    <span className="waiting__text">
                      {w.text}
                      <span className="mono muted waiting__meta">
                        {w.id} · {mine ? "você decide" : `${owner?.name ?? "—"} decide`} · {w.since}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="noite">
            <h2 id="noite" className="label-caps section__title">
              O que os agentes fizeram esta noite
            </h2>
            <ol className="module log" role="list">
              {NIGHT_LOG.map((e) => {
                const p = findPersona(e.personId);
                if (!p) return null;
                return (
                  <li key={e.at + e.personId} className="log__item">
                    <span className="mono muted log__time">
                      {p.cityCode} {localTime(new Date(e.at), p.timezone)}
                    </span>
                    <PixelAvatar persona={p} size={24} />
                    <p className="log__text">
                      <Link href={`/pessoas/${p.id}`} className="log__agent">
                        Agente de {p.name}
                      </Link>{" "}
                      {e.text}
                    </p>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>
      )}
    </>
  );
}
