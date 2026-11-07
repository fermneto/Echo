"use client";

import { useState } from "react";
import { summaryLine, type WeekReport } from "@/lib/demo/reports";

type Status = "aguardando" | "confirmado" | "enviado";
const STATUS: Record<Status, { label: string; tone: "wait" | "on" | "twin" }> = {
  aguardando: { label: "Aguardando a sua confirmação", tone: "wait" },
  confirmado: { label: "Confirmado por você · segue ao RH em 3 dias", tone: "on" },
  enviado: { label: "Enviado ao RH", tone: "twin" },
};

export function Metrics({ r }: { r: WeekReport }) {
  return (
    <dl className="metrics">
      {[
        ["Entregas", r.deliveries],
        ["Commits", r.commits],
        ["Revisões", r.reviews],
        ["Ajudas", r.helps.length],
      ].map(([k, v]) => (
        <div key={k} className="metric">
          <dd className="metric__v">{v}</dd>
          <dt className="metric__k mono">{k}</dt>
        </div>
      ))}
    </dl>
  );
}

export function Helps({ r }: { r: WeekReport }) {
  if (r.helps.length === 0) return null;
  return (
    <div className="helps">
      <p className="field-row__k mono">Ajudas a colegas</p>
      <ul className="helps__list" role="list">
        {r.helps.map((h) => (
          <li key={h.to + h.what}>
            <span>
              {h.to}: {h.what}
            </span>
            <span className="chip mono">
              <span className="dot dot--on" aria-hidden="true" />
              {h.source}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Relatório da própria pessoa: confere, comenta e confirma. Texto dela nunca muda os números. */
export function ReportCard({ name, report }: { name: string; report: WeekReport }) {
  const [status, setStatus] = useState<Status>("aguardando");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const s = STATUS[status];

  return (
    <section className="card report" aria-labelledby="semana">
      <h2 id="semana" className="card__title">
        Semana de {report.week}
      </h2>
      <p className={`chip mono report__status is-${s.tone}`} role="status">
        <span className={`dot dot--${s.tone}`} aria-hidden="true" />
        {s.label}
      </p>
      <p className="report__summary">{summaryLine(name, report)}</p>
      <Metrics r={report} />
      <Helps r={report} />

      {note && (
        <div className="report__note">
          <p className="field-row__k mono">Observação</p>
          <p>{note}</p>
          <span className="chip mono is-wait">
            <span className="dot dot--wait" aria-hidden="true" />
            Informado pela pessoa · não altera os números
          </span>
        </div>
      )}

      {status === "aguardando" && (
        <>
          <label className="field-row__k mono report__label" htmlFor="obs">
            Observações
          </label>
          <textarea id="obs" className="field report__textarea" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Algo que os números não mostram? Escreva aqui." maxLength={600} />
          <div className="report__actions">
            <button type="button" className="button-outline" disabled={!draft.trim()} onClick={() => (setNote(draft.trim()), setDraft(""))}>
              Salvar observação
            </button>
            <button type="button" className="button-pill" onClick={() => setStatus("confirmado")}>
              Confirmar relatório
            </button>
          </div>
        </>
      )}
      {status !== "enviado" && (
        <button type="button" className="button-outline report__simulate" onClick={() => setStatus("enviado")}>
          Simular o envio automático
        </button>
      )}
    </section>
  );
}

/** Registrar uma ajuda recebida: aparece no relatório de quem ajudou. */
export function HelpForm({ people }: { people: string[] }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <section className="card" aria-labelledby="ajudou">
      <h2 id="ajudou" className="card__title">
        Alguém ajudou você?
      </h2>
      <p className="muted help-intro">Opcional. A ajuda confirmada por você aparece no relatório de quem ajudou.</p>
      {done ? (
        <p className="help-done" role="status">
          <span className="dot dot--on" aria-hidden="true" /> Ajuda registrada no relatório de {done}.
        </p>
      ) : (
        <form
          className="help-form"
          onSubmit={(e) => {
            e.preventDefault();
            setDone(String(new FormData(e.currentTarget).get("quem")));
          }}
        >
          <label className="field-row__k mono" htmlFor="quem">
            Quem ajudou
          </label>
          <select id="quem" name="quem" className="field">
            {people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <label className="field-row__k mono" htmlFor="oque">
            O que aconteceu
          </label>
          <select id="oque" name="oque" className="field">
            <option>Me ajudou numa entrega</option>
            <option>Revisou e sugeriu uma mudança</option>
            <option>Destravou algo que estava parado</option>
          </select>
          <label className="field-row__k mono" htmlFor="emque">
            Em quê
          </label>
          <input id="emque" name="emque" className="field" placeholder="ECH-128 ou o assunto da ajuda" />
          <button type="submit" className="button-pill">
            Confirmar ajuda
          </button>
        </form>
      )}
    </section>
  );
}
