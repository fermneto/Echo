"use client";

import { useState, useTransition } from "react";
import type { Assignment } from "@/lib/demo/redistribution";
import type { Decision } from "@/lib/decisions-store";
import { decidir } from "./actions";

type Phase = "registrar" | "proposto" | "confirmar" | "aprovado";

const names = (list: string[]) => (list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} e ${list.at(-1)}`);

/**
 * Registrar uma ausência gera um plano por regra; nada muda até a liderança aprovar. Aprovar
 * pede uma confirmação que diz o que muda e quem é avisado, e pode ser desfeito depois.
 */
export function Redistribution({
  people,
  absence,
  plan,
  unassigned,
  approved,
  looseApproved,
}: {
  people: string[];
  absence: { name: string; kind: string; from: string; to: string };
  plan: readonly Assignment[];
  unassigned: { item: string; title: string; suggestion: string; reason: string };
  approved: Decision | null;
  looseApproved: Decision | null;
}) {
  const [phase, setPhase] = useState<Phase>(approved ? "aprovado" : "registrar");
  const [decision, setDecision] = useState<Decision | null>(approved);
  const [who, setWho] = useState(absence.name);
  const [loose, setLoose] = useState<"aberta" | "sugerida" | "distribuida">(looseApproved ? "distribuida" : "aberta");
  const [looseDecision, setLooseDecision] = useState<Decision | null>(looseApproved);
  const [pending, start] = useTransition();
  const receivers = [...new Set(plan.map((a) => a.to))];
  const locked = phase === "confirmar" || phase === "aprovado";

  const apply = (aprovar: boolean) =>
    start(async () => {
      const r = await decidir("ferias-bruno", aprovar);
      if (!r.ok) return;
      setDecision(aprovar ? { by: "você", at: r.at ?? "" } : null);
      setPhase(aprovar ? "aprovado" : "proposto");
    });

  const applyLoose = (aprovar: boolean) =>
    start(async () => {
      const r = await decidir("ech-160", aprovar);
      if (!r.ok) return;
      setLooseDecision(aprovar ? { by: "você", at: r.at ?? "" } : null);
      setLoose(aprovar ? "distribuida" : "aberta");
    });

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
              <select className="field" value={who} onChange={(e) => (setWho(e.target.value), setPhase("registrar"))} disabled={locked}>
                {people.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="absence-form__field">
              <span className="field-row__k mono">Tipo</span>
              <select className="field" defaultValue={absence.kind} disabled={locked}>
                <option>Férias</option>
                <option>Licença</option>
                <option>Ausência imprevista</option>
              </select>
            </label>
            <label className="absence-form__field">
              <span className="field-row__k mono">De</span>
              <input className="field" defaultValue={absence.from} disabled={locked} />
            </label>
            <label className="absence-form__field">
              <span className="field-row__k mono">Até</span>
              <input className="field" defaultValue={absence.to} disabled={locked} />
            </label>
            <button type="submit" className="button-pill" disabled={phase !== "registrar"}>
              {phase === "registrar" ? "Gerar plano" : "Plano gerado"}
            </button>
          </form>
          <p className="card__foot">O motivo da ausência não é pedido nem guardado.</p>
        </section>

        {phase !== "registrar" && (
          <section className="card plan-card" aria-labelledby="plano-ferias">
            <h2 id="plano-ferias" className="card__title">
              Plano para {who === absence.name ? `as férias de ${absence.name} (${absence.from} a ${absence.to})` : `a ausência de ${who}`}
            </h2>
            {who !== absence.name ? (
              <p className="muted">{who} não tem tarefas abertas no período. Nada a redistribuir.</p>
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
                    <span className={`chip mono assign__state is-${phase === "aprovado" ? "done" : "wait"}`}>
                      <span className={`dot dot--${phase === "aprovado" ? "off" : "wait"}`} aria-hidden="true" />
                      {phase === "aprovado" ? "aplicado" : "proposto"}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {phase === "proposto" && who === absence.name && (
              <div className="plan-card__actions">
                <button type="button" className="button-pill" onClick={() => setPhase("confirmar")}>
                  Aprovar plano
                </button>
                <button type="button" className="button-outline" onClick={() => setPhase("registrar")}>
                  Descartar
                </button>
                <p className="muted plan-card__note">Nada muda até você aprovar. Quem recebe pode recusar com motivo.</p>
              </div>
            )}

            {phase === "confirmar" && (
              <div className="plan-confirm" role="group" aria-labelledby="confirmar-titulo">
                <p id="confirmar-titulo" className="plan-confirm__title">
                  Aplicar {plan.length} mudanças no Linear e no GitHub?
                </p>
                <p className="plan-confirm__text">
                  {names(receivers)} {receivers.length === 1 ? "recebe" : "recebem"} as tarefas e {receivers.length === 1 ? "é avisado" : "são avisados"} no Slack. Cada um pode recusar com motivo, e você pode desfazer.
                </p>
                <div className="plan-card__actions">
                  <button type="button" className="button-pill" onClick={() => apply(true)} disabled={pending}>
                    {pending ? "Aplicando…" : "Confirmar e aplicar"}
                  </button>
                  <button type="button" className="button-outline" onClick={() => setPhase("proposto")} disabled={pending}>
                    Voltar
                  </button>
                </div>
              </div>
            )}

            {phase === "aprovado" && (
              <div className="plan-done" role="status">
                <p className="plan-done__title">
                  Plano aplicado{decision ? ` por ${decision.by}${decision.at ? ` em ${decision.at}` : ""}` : ""}.
                </p>
                <p className="plan-done__text">
                  {names(receivers)} {receivers.length === 1 ? "foi avisado" : "foram avisados"}. A mudança está na auditoria, em Custo e execuções.
                </p>
                <button type="button" className="link-inline" onClick={() => apply(false)} disabled={pending}>
                  {pending ? "Desfazendo…" : "Desfazer e devolver as tarefas"}
                </button>
              </div>
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
                  <button type="button" className="button-pill" onClick={() => applyLoose(true)} disabled={pending}>
                    Atribuir a {unassigned.suggestion}
                  </button>
                  <button type="button" className="button-outline" onClick={() => setLoose("aberta")} disabled={pending}>
                    Cancelar
                  </button>
                </div>
              </>
            )}
            {loose === "distribuida" && (
              <div className="plan-done" role="status">
                <p className="plan-done__title">
                  {unassigned.item} atribuída a {unassigned.suggestion}
                  {looseDecision?.at ? ` em ${looseDecision.at}` : ""}.
                </p>
                <button type="button" className="link-inline" onClick={() => applyLoose(false)} disabled={pending}>
                  Desfazer
                </button>
              </div>
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
