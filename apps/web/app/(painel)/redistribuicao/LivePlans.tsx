"use client";

import { Reveal } from "@/components/Reveal";
import { useState, useTransition } from "react";
import { ABSENCE_KINDS, confirmText, type PlanView } from "@/lib/redistribution";
import { aprovarPlano, descartarPlano, registrarAusencia, repassarItem, type FlowResult } from "./actions";

type Person = { id: string; name: string };

/** Escolha de quem recebe, no próprio item: lista da equipe, confirmar ou cancelar. */
function PersonPicker({ people, exclude, action, pending, onPick, onCancel }: { people: Person[]; exclude?: string; action: string; pending: boolean; onPick: (p: Person) => void; onCancel: () => void }) {
  const options = people.filter((p) => p.id !== exclude);
  const [value, setValue] = useState(options[0]?.id ?? "");
  return (
    <div className="assign-picker">
      <label className="sr-only" htmlFor="assign-picker">
        Quem recebe
      </label>
      <select id="assign-picker" className="field assign-picker__select" value={value} onChange={(e) => setValue(e.target.value)} disabled={pending}>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button-pill button-pill--sm"
        disabled={pending || !value}
        onClick={() => {
          const p = options.find((o) => o.id === value);
          if (p) onPick(p);
        }}
      >
        {action}
      </button>
      <button type="button" className="link-inline assign__toggle" onClick={onCancel} disabled={pending}>
        Cancelar
      </button>
    </div>
  );
}

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

function PlanCard({ plan, people: team }: { plan: PlanView; people: Person[] }) {
  // Quem está ausente nunca recebe: fica fora da escolha.
  const people = team.filter((p) => p.name !== plan.absentName);
  const [confirming, setConfirming] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  /** Trocas feitas pela liderança antes de aprovar: item → pessoa escolhida. */
  const [adjusted, setAdjusted] = useState<Map<string, Person>>(new Map());
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const awaiting = plan.state === "awaiting_leader";
  const confirm = confirmText(plan.items, excluded, new Map([...adjusted].map(([k, p]) => [k, p.name])));

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
          const chosen = adjusted.get(a.id);
          const to = chosen?.name ?? a.to;
          const chip = out ? { label: "fora do plano", tone: "off" as const } : a.chip;
          return (
            <li key={a.id} className={`assign${out ? " is-out" : ""}`}>
              <span className="assign__item mono">{a.item}</span>
              <div className="assign__body">
                <p className="assign__title">
                  {a.title}{" "}
                  {to ? (
                    <>
                      <span className="assign__arrow" aria-hidden="true">
                        →
                      </span>{" "}
                      <b>{to}</b>
                    </>
                  ) : null}
                </p>
                <p className="assign__why">
                  {chosen ? "Escolhida por você. As regras de ausência e conta no tracker de tarefas são conferidas ao aprovar." : a.reason}
                  {a.load && !chosen ? <span className="assign__load mono"> · {a.load}</span> : null}
                </p>
                {picking === a.id ? (
                  <PersonPicker
                    people={people}
                    exclude={chosen?.id ?? a.toId}
                    action={a.excludable ? "Trocar" : "Passar"}
                    pending={pending}
                    onCancel={() => setPicking(null)}
                    onPick={(p) => {
                      setPicking(null);
                      if (a.excludable) setAdjusted((m) => new Map(m).set(a.id, p));
                      else run(() => repassarItem(a.id, p.id));
                    }}
                  />
                ) : (
                  <div className="assign__links">
                    {a.excludable && !confirming && !out && (
                      <button type="button" className="link-inline assign__toggle" onClick={() => setPicking(a.id)} disabled={pending}>
                        {chosen ? "Trocar de novo" : "Trocar quem recebe"}
                      </button>
                    )}
                    {chosen && !confirming && (
                      <button
                        type="button"
                        className="link-inline assign__toggle"
                        onClick={() =>
                          setAdjusted((m) => {
                            const n = new Map(m);
                            n.delete(a.id);
                            return n;
                          })
                        }
                        disabled={pending}
                      >
                        Voltar à sugestão
                      </button>
                    )}
                    {a.excludable && !confirming && (
                      <button type="button" className="link-inline assign__toggle" onClick={() => toggle(a.id)} disabled={pending}>
                        {out ? "Incluir de volta" : "Deixar de fora"}
                      </button>
                    )}
                    {a.reassignable && (
                      <button type="button" className="link-inline assign__toggle" onClick={() => setPicking(a.id)} disabled={pending}>
                        Passar para…
                      </button>
                    )}
                  </div>
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
          <p className="muted plan-card__note">Nada muda até você aprovar.</p>
        </div>
      )}

      {awaiting && confirming && (
        <Reveal className="plan-confirm" role="group" aria-labelledby={`confirmar-${plan.id}`}>
          <p id={`confirmar-${plan.id}`} className="plan-confirm__title">
            {confirm.title}
          </p>
          <p className="plan-confirm__text">{confirm.text}</p>
          <div className="plan-card__actions">
            <button type="button" className="button-pill" onClick={() => run(() => aprovarPlano(plan.id, [...excluded], [...adjusted].filter(([k]) => !excluded.has(k)).map(([itemId, p]) => ({ itemId, toId: p.id }))))} disabled={pending}>
              {pending ? "Aplicando…" : "Confirmar e aplicar"}
            </button>
            <button type="button" className="button-outline" onClick={() => setConfirming(false)} disabled={pending}>
              Voltar
            </button>
          </div>
        </Reveal>
      )}

      {plan.outcome && (
        <Reveal className="plan-done" role="status">
          <p className="plan-done__title">{plan.outcome.title}</p>
          <p className="plan-done__text">{plan.outcome.text}</p>
        </Reveal>
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
          <PlanCard key={p.id} plan={p} people={people} />
        ))}
        {decided.length > 0 && (
          <section className="section" aria-labelledby="decididos">
            <h2 id="decididos" className="section__title label-caps">
              Decididos nos últimos 7 dias
            </h2>
            {decided.map((p) => (
              <PlanCard key={p.id} plan={p} people={people} />
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
