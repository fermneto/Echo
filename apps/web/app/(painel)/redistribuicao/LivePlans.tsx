"use client";

import { useState, useTransition } from "react";
import { ABSENCE_KINDS, confirmText, type PlanView } from "@/lib/redistribution";
import { aprovarPlano, descartarPlano, registrarAusencia, type FlowResult } from "./actions";

function AbsenceForm({ people, today }: { people: { id: string; name: string }[]; today: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FlowResult | null>(null);
  return (
    <section className="card" aria-labelledby="ausencia">
      <h2 id="ausencia" className="card__title">
        Registrar ausência
      </h2>
      {people.length === 0 ? (
        <p className="muted">Ninguém da sua equipe para registrar.</p>
      ) : (
        <form
          className="absence-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const get = (k: string) => String(f.get(k) ?? "");
            start(async () => setResult(await registrarAusencia({ personId: get("quem"), kind: get("tipo"), startDate: get("de"), endDate: get("ate") })));
          }}
        >
          <label className="absence-form__field">
            <span className="field-row__k mono">Quem</span>
            <select className="field" name="quem" required disabled={pending}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="absence-form__field">
            <span className="field-row__k mono">Tipo</span>
            <select className="field" name="tipo" defaultValue={ABSENCE_KINDS[0]} disabled={pending}>
              {ABSENCE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="absence-form__field">
            <span className="field-row__k mono">De</span>
            <input className="field" type="date" name="de" required min={today} defaultValue={today} disabled={pending} />
          </label>
          <label className="absence-form__field">
            <span className="field-row__k mono">Até</span>
            <input className="field" type="date" name="ate" required min={today} defaultValue={today} disabled={pending} />
          </label>
          <button type="submit" className="button-pill" disabled={pending}>
            {pending ? "Gerando…" : "Gerar plano"}
          </button>
        </form>
      )}
      {result && !result.ok && (
        <p className="redist-msg is-error" role="alert">
          {result.error}
        </p>
      )}
      {result?.ok && result.message && (
        <p className="redist-msg" role="status">
          {result.message}
        </p>
      )}
      <p className="card__foot">O motivo da ausência não é pedido nem guardado.</p>
    </section>
  );
}

function PlanCard({ plan }: { plan: PlanView }) {
  const [confirming, setConfirming] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const awaiting = plan.state === "awaiting_leader";
  const confirm = confirmText(plan.items, excluded);

  const run = (fn: () => Promise<FlowResult>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      else if (r.message) setWarning(r.message);
      setConfirming(false);
    });

  const toggle = (id: string) =>
    setExcluded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="card plan-card" aria-labelledby={`plano-${plan.id}`}>
      <h2 id={`plano-${plan.id}`} className="card__title">
        {plan.title}
      </h2>
      <ul className="assign-list" role="list">
        {plan.items.map((a) => {
          const out = excluded.has(a.id);
          const chip = out ? { label: "fora do plano", tone: "off" as const } : a.chip;
          return (
            <li key={a.id} className={`assign${out ? " is-out" : ""}`}>
              <span className="assign__item mono">{a.item}</span>
              <div className="assign__body">
                <p className="assign__title">
                  {a.title}{" "}
                  {a.to ? (
                    <>
                      <span className="assign__arrow" aria-hidden="true">
                        →
                      </span>{" "}
                      <b>{a.to}</b>
                    </>
                  ) : null}
                </p>
                <p className="assign__why">
                  {a.reason}
                  {a.load ? <span className="assign__load mono"> · {a.load}</span> : null}
                </p>
                {a.excludable && !confirming && (
                  <button type="button" className="link-inline assign__toggle" onClick={() => toggle(a.id)} disabled={pending}>
                    {out ? "Incluir de volta" : "Deixar de fora"}
                  </button>
                )}
              </div>
              <span className={`chip mono assign__state is-${chip.tone}`}>
                <span className={`dot dot--${chip.tone === "done" || chip.tone === "off" ? "off" : chip.tone}`} aria-hidden="true" />
                {chip.label}
              </span>
            </li>
          );
        })}
      </ul>

      {awaiting && !confirming && (
        <div className="plan-card__actions">
          <button type="button" className="button-pill" onClick={() => setConfirming(true)} disabled={pending || excluded.size === plan.items.length}>
            Aprovar plano
          </button>
          <button type="button" className="button-outline" onClick={() => run(() => descartarPlano(plan.id))} disabled={pending}>
            {pending ? "Descartando…" : "Descartar"}
          </button>
          <p className="muted plan-card__note">Nada muda até você aprovar. Quem recebe pode recusar com motivo.</p>
        </div>
      )}

      {awaiting && confirming && (
        <div className="plan-confirm" role="group" aria-labelledby={`confirmar-${plan.id}`}>
          <p id={`confirmar-${plan.id}`} className="plan-confirm__title">
            {confirm.title}
          </p>
          <p className="plan-confirm__text">{confirm.text}</p>
          <div className="plan-card__actions">
            <button type="button" className="button-pill" onClick={() => run(() => aprovarPlano(plan.id, [...excluded]))} disabled={pending}>
              {pending ? "Aplicando…" : "Confirmar e aplicar"}
            </button>
            <button type="button" className="button-outline" onClick={() => setConfirming(false)} disabled={pending}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {plan.outcome && (
        <div className="plan-done" role="status">
          <p className="plan-done__title">{plan.outcome.title}</p>
          <p className="plan-done__text">{plan.outcome.text}</p>
        </div>
      )}
      {warning && (
        <p className="redist-msg" role="status">
          {warning}
        </p>
      )}
      {error && (
        <p className="redist-msg is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** Redistribuição com o banco: planos por regra esperando você e os decididos nos últimos dias. */
export function LivePlans({ people, plans, today }: { people: { id: string; name: string }[]; plans: PlanView[]; today: string }) {
  const awaiting = plans.filter((p) => p.state === "awaiting_leader");
  const decided = plans.filter((p) => p.state !== "awaiting_leader");
  return (
    <div className="profile-grid">
      <div className="profile-col">
        <AbsenceForm people={people} today={today} />
        {awaiting.length === 0 && <p className="note muted">Nenhum plano esperando você.</p>}
        {awaiting.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
        {decided.length > 0 && (
          <section className="section" aria-labelledby="decididos">
            <h2 id="decididos" className="section__title label-caps">
              Decididos nos últimos 7 dias
            </h2>
            {decided.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </section>
        )}
      </div>
      <div className="profile-col">
        <section className="card" aria-labelledby="regra">
          <h2 id="regra" className="card__title">
            Como o plano é feito
          </h2>
          <ul className="rule-list">
            <li>Quem recebe precisa ter a área da tarefa ou, sem área, a maior folga.</li>
            <li>Ninguém passa do limite de carga da equipe. A carga ao lado do motivo é a de hoje, em pontos.</li>
            <li>Quem está ausente no período não recebe nada.</li>
            <li>O texto do motivo é escrito por regra; o modelo não escolhe pessoas.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
