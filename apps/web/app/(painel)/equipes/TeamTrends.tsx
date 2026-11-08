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

/** Teto da escala de cada equipe: múltiplo de 5 acima do maior valor dela. Cada equipe tem a própria régua, para
 * mostrar a evolução dela e não virar comparação entre equipes ("quem rende mais"). */
const ceil = (v: number) => Math.max(5, Math.ceil(v / 5) * 5);

/** Evolução de cada equipe frente a ela mesma, com a semana em destaque. Sem tabela de equipes lado a lado. */
export function TeamTrends({ weeks, focus, teams }: { weeks: TrendWeek[]; focus: string; teams: TrendTeam[] }) {
  const [metric, setMetric] = useState<TrendMetric>("deliveries");
  const [hover, setHover] = useState<{ team: string; i: number } | null>(null);
  const def = METRICS.find((m) => m.key === metric)!;
  const fromReports = metric !== "twins";
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
          const max = ceil(Math.max(0, ...vals));
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

      <p className="mono muted">Cada equipe na própria escala: o gráfico mostra a evolução dela, não serve para comparar equipes.</p>
    </section>
  );
}
