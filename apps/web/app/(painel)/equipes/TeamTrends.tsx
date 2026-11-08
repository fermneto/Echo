"use client";

import { useState } from "react";

export type TrendMetric = "deliveries" | "reviews" | "helps" | "twins";
export type TrendWeek = { week: string; label: string; short: string; open: boolean };
export type TrendTeam = { id: string; name: string; people: number; values: Record<TrendMetric, number[]>; sent: number[] };

const METRICS: { key: TrendMetric; label: string; one: string; many: string }[] = [
  { key: "deliveries", label: "Entregas", one: "entrega", many: "entregas" },
  { key: "reviews", label: "Revisões", one: "revisão", many: "revisões" },
  { key: "helps", label: "Ajudas", one: "ajuda entre colegas", many: "ajudas entre colegas" },
  { key: "twins", label: "Gêmeos", one: "resposta do gêmeo", many: "respostas dos gêmeos" },
];

/** Teto da escala comum: múltiplo de 5 acima do maior valor, para comparar as equipes pela mesma régua. */
const ceil = (v: number) => Math.max(5, Math.ceil(v / 5) * 5);

/** Evolução por equipe em múltiplos pequenos, com a mesma escala, a semana em destaque e a tabela alternativa. */
export function TeamTrends({ weeks, focus, teams }: { weeks: TrendWeek[]; focus: string; teams: TrendTeam[] }) {
  const [metric, setMetric] = useState<TrendMetric>("deliveries");
  const [hover, setHover] = useState<{ team: string; i: number } | null>(null);
  const def = METRICS.find((m) => m.key === metric)!;
  const fromReports = metric !== "twins";
  const max = ceil(Math.max(0, ...teams.flatMap((t) => t.values[metric])));
  const count = (v: number) => `${v} ${v === 1 ? def.one : def.many}`;

  return (
    <section className="card hr-trends" aria-labelledby="hr-trends-title">
      <header className="hr-trends__head">
        <h2 id="hr-trends-title" className="card__title">
          Por equipe, últimas {weeks.length} semanas
        </h2>
        <div className="hr-tabs" role="tablist" aria-label="Número mostrado">
          {METRICS.map((m) => (
            <button key={m.key} type="button" role="tab" aria-selected={m.key === metric} className={`hr-tabs__tab${m.key === metric ? " is-on" : ""}`} onClick={() => setMetric(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </header>

      <div className="hr-multiples">
        {teams.map((t) => {
          const vals = t.values[metric];
          const fi = weeks.findIndex((w) => w.week === focus);
          const shown = hover?.team === t.id ? hover.i : fi;
          const sw = weeks[shown];
          return (
            <figure key={t.id} className="hr-multiple" aria-label={`${def.label} de ${t.name} por semana`}>
              <figcaption className="hr-multiple__cap">
                <span className="hr-multiple__name">{t.name}</span>
                <span className="hr-multiple__v">
                  <strong>{vals[shown] ?? 0}</strong>
                  <span className="mono muted"> {sw ? `${sw.open && fromReports ? "semana aberta" : sw.short}` : ""}</span>
                </span>
              </figcaption>
              <div className="hr-plot" style={{ ["--hr-max" as string]: max }}>
                <span className="hr-plot__grid mono" aria-hidden>
                  {max}
                </span>
                <div className="hr-plot__bars" onMouseLeave={() => setHover(null)}>
                  {weeks.map((w, i) => {
                    const v = vals[i] ?? 0;
                    const pending = w.open && fromReports;
                    const tip = `${w.label}: ${pending ? "semana aberta, os relatórios chegam depois do fim da semana" : count(v)}${fromReports && !pending ? ` · ${t.sent[i] ?? 0} de ${t.people} relatórios` : ""}`;
                    return (
                      <div
                        key={w.week}
                        className={`hr-col${w.week === focus ? " is-focus" : ""}${pending ? " is-open" : ""}${hover?.team === t.id && hover.i === i ? " is-hover" : ""}`}
                        tabIndex={0}
                        aria-label={tip}
                        onMouseEnter={() => setHover({ team: t.id, i })}
                        onFocus={() => setHover({ team: t.id, i })}
                        onBlur={() => setHover(null)}
                      >
                        <span className="hr-col__bar" style={{ height: pending ? "100%" : `${(v / max) * 100}%` }} />
                        {hover?.team === t.id && hover.i === i ? (
                          <span className="hr-tip" role="tooltip">
                            {tip}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="hr-plot__x mono muted" aria-hidden>
                <span>{weeks[0]?.short}</span>
                <span>atual</span>
              </div>
            </figure>
          );
        })}
      </div>

      <details className="hr-table">
        <summary>Ver em tabela</summary>
        <div className="hr-table__scroll">
          <table>
            <caption className="sr-only">
              {def.label} por equipe e semana
            </caption>
            <thead>
              <tr>
                <th scope="col">Equipe</th>
                {weeks.map((w) => (
                  <th key={w.week} scope="col" className="mono">
                    {w.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <th scope="row">{t.name}</th>
                  {weeks.map((w, i) => (
                    <td key={w.week} className="mono">
                      {w.open && fromReports ? "—" : (t.values[metric][i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
