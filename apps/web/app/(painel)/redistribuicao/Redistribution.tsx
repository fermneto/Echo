"use client";

import { useState } from "react";
import type { Assignment } from "@/lib/demo/redistribution";

type Phase = "registrar" | "proposto" | "aprovado";

/**
 * Cena da demo: registrar uma ausência gera um plano por regra; nada muda até a liderança aprovar.
 * Depois de aprovar, cada mudança mostra que foi aplicada (simulada até o executor do outbox).
 */
export function Redistribution({
  people,
  absence,
  plan,
  unassigned,
  leader,
}: {
  people: string[];
  absence: { name: string; kind: string; from: string; to: string };
  plan: readonly Assignment[];
  unassigned: { item: string; title: string; suggestion: string; reason: string };
  leader: string;
}) {
  const [phase, setPhase] = useState<Phase>("registrar");
  const [who, setWho] = useState(absence.name);
  const [loose, setLoose] = useState<"aberta" | "sugerida" | "distribuida">("aberta");

  return (
    <div className="profile-grid">
      <div className="profile-col">
        <section className="card" aria-labelledby="ausencia">
          <h2 id="ausencia" className="card__title">
            Registrar ausência
          </h2>
          <form
            className="absence-form"
            onSubmit={(e) => {
              e.preventDefault();
              setPhase("proposto");
            }}
          >
            <label className="absence-form__field">
              <span className="field-row__k mono">Quem</span>
              <select className="field" value={who} onChange={(e) => (setWho(e.target.value), setPhase("registrar"))} disabled={phase === "aprovado"}>
                {people.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="absence-form__field">
              <span className="field-row__k mono">Tipo</span>
              <select className="field" defaultValue={absence.kind} disabled={phase === "aprovado"}>
                <option>Férias</option>
                <option>Licença</option>
                <option>Ausência imprevista</option>
              </select>
            </label>
            <label className="absence-form__field">
              <span className="field-row__k mono">De</span>
              <input className="field" defaultValue={absence.from} disabled={phase === "aprovado"} />
            </label>
            <label className="absence-form__field">
              <span className="field-row__k mono">Até</span>
              <input className="field" defaultValue={absence.to} disabled={phase === "aprovado"} />
            </label>
            <button type="submit" className="button-pill" disabled={phase !== "registrar"}>
              Gerar plano
            </button>
          </form>
          <p className="card__foot mono">O motivo da ausência não é pedido nem guardado.</p>
        </section>

        {phase !== "registrar" && (
          <section className="card plan-card" aria-labelledby="plano-ferias">
            <h2 id="plano-ferias" className="card__title">
              Plano para {who === absence.name ? `as férias de ${absence.name} (${absence.from} a ${absence.to})` : `a ausência de ${who}`}
            </h2>
            {who !== absence.name ? (
              <p className="muted">Na demo, só a ausência de {absence.name} tem tarefas abertas para redistribuir.</p>
            ) : (
              <ul className="assign-list" role="list">
                {plan.map((a) => (
                  <li key={a.item} className="assign">
                    <span className="assign__item mono">{a.item}</span>
                    <div className="assign__body">
                      <p className="assign__title">
                        {a.title} <span className="assign__arrow" aria-hidden="true">→</span> <b>{a.to}</b>
                      </p>
                      <p className="assign__why">{a.reason}</p>
                    </div>
                    <span className={`chip mono assign__state is-${phase === "aprovado" ? "on" : "wait"}`}>
                      <span className={`dot dot--${phase === "aprovado" ? "on" : "wait"}`} aria-hidden="true" />
                      {phase === "aprovado" ? "aplicado no Linear · simulado" : "proposto"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {phase === "proposto" && who === absence.name && (
              <div className="plan-card__actions">
                <button type="button" className="button-pill" onClick={() => setPhase("aprovado")}>
                  Aprovar plano
                </button>
                <button type="button" className="button-outline" onClick={() => setPhase("registrar")}>
                  Descartar
                </button>
                <p className="muted plan-card__note">Nada muda até você aprovar. Quem recebe pode recusar com motivo.</p>
              </div>
            )}
            {phase === "aprovado" && (
              <p className="plan-card__done" role="status">
                <span className="dot dot--on" aria-hidden="true" /> Aprovado por {leader}. Cada pessoa foi avisada e pode recusar com motivo.
              </p>
            )}
          </section>
        )}
      </div>

      <div className="profile-col">
        <section className="card" aria-labelledby="sem-dono">
          <h2 id="sem-dono" className="card__title">
            Sem responsável
          </h2>
          <div className="loose">
            <p className="assign__title">
              <span className="mono">{unassigned.item}</span> · {unassigned.title}
            </p>
            {loose === "aberta" && (
              <button type="button" className="button-outline" onClick={() => setLoose("sugerida")}>
                Distribuir
              </button>
            )}
            {loose === "sugerida" && (
              <>
                <p className="assign__why">
                  Sugestão: <b>{unassigned.suggestion}</b>. {unassigned.reason}
                </p>
                <div className="plan-card__actions">
                  <button type="button" className="button-pill" onClick={() => setLoose("distribuida")}>
                    Aprovar
                  </button>
                  <button type="button" className="button-outline" onClick={() => setLoose("aberta")}>
                    Descartar
                  </button>
                </div>
              </>
            )}
            {loose === "distribuida" && (
              <p className="plan-card__done" role="status">
                <span className="dot dot--on" aria-hidden="true" /> {unassigned.item} → {unassigned.suggestion} · aplicado no Linear · simulado
              </p>
            )}
          </div>
        </section>
        <section className="card" aria-labelledby="regra">
          <h2 id="regra" className="card__title">
            Como o plano é feito
          </h2>
          <ul className="rule-list">
            <li>Quem recebe precisa ter a área da tarefa ou, sem área, a maior folga.</li>
            <li>Ninguém passa do limite de carga da equipe.</li>
            <li>Quem está ausente no período não recebe nada.</li>
            <li>O texto do motivo é escrito por regra; o modelo não escolhe pessoas.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
