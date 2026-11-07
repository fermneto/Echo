"use client";

import { useActionState, useState } from "react";
import { ProductWindow } from "@/components/ProductWindow";
import { perguntar, type AskState } from "./actions";

const INITIAL: AskState = { turns: [] };

export function AskTwin({ personId, personName, askerName, suggestions }: { personId: string; personName: string; askerName: string; suggestions: string[] }) {
  const [state, action, pending] = useActionState(perguntar, INITIAL);
  const [question, setQuestion] = useState("");

  return (
    <ProductWindow title={`Pergunte ao gêmeo de ${personName}`} footer={`O agente só lê. Decisões ficam com ${personName}.`}>
      <ol className="chat" aria-live="polite">
        {state.turns.length === 0 && <li className="chat__empty muted">Pergunte sobre branches, tarefas ou quando {personName} volta.</li>}
        {state.turns.map((t, i) => (
          <li key={i} className="chat__turn">
            <p className="chat__line">
              <span className="chat__who">{askerName}</span> {t.question}
            </p>
            <div className={`chat__line chat__reply chat__reply--${t.reply.kind}`}>
              <span className="chat__who chat__who--twin">{t.reply.speaker}</span> {t.reply.text}
              {t.reply.warning && <p className="chat__warning">Aviso: {t.reply.warning}</p>}
              {t.reply.sources.length > 0 && (
                <ul className="sources" role="list" aria-label="Fontes">
                  {t.reply.sources.map((s) => (
                    <li key={s} className="pill-source mono">
                      Fonte: {s}
                    </li>
                  ))}
                </ul>
              )}
              {t.reply.needsOwner && <p className="mono muted chat__meta">ENTRA NO PLANO DA MANHÃ DE {personName.toUpperCase()}</p>}
            </div>
          </li>
        ))}
      </ol>

      <form action={action} className="ask-form" onSubmit={() => setTimeout(() => setQuestion(""), 0)}>
        <input type="hidden" name="pessoa" value={personId} />
        <label htmlFor="pergunta" className="mono muted">
          PERGUNTA
        </label>
        <div className="ask-form__row">
          <input id="pergunta" name="pergunta" className="field" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={`@${personName} posso seguir com…`} maxLength={500} autoComplete="off" required />
          <button type="submit" className="button-app-primary" disabled={pending}>
            {pending ? "Consultando…" : "Perguntar"}
          </button>
        </div>
        {state.error && <p className="error">{state.error}</p>}
      </form>

      {suggestions.length > 0 && (
        <div className="suggestions">
          <span className="mono muted">EXPERIMENTE</span>
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip-button" onClick={() => setQuestion(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </ProductWindow>
  );
}
