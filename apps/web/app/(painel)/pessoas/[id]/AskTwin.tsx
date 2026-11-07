"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ProductWindow } from "@/components/ProductWindow";
import { perguntar, type AskState } from "./actions";

const INITIAL: AskState = { turns: [] };

export function AskTwin({ personId, personName, askerName, suggestions }: { personId: string; personName: string; askerName: string; suggestions: string[] }) {
  const [state, action, pending] = useActionState(perguntar, INITIAL);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const agent = `Agente de ${personName}`;

  useEffect(() => {
    if (!pending) setAsking("");
  }, [pending]);

  return (
    <ProductWindow title={`Pergunte ao gêmeo de ${personName}`} footer={`O agente só lê e cita a fonte. Quem decide é ${personName}.`}>
      <ol className="chat" aria-live="polite" aria-busy={pending}>
        {state.turns.length === 0 && !pending && (
          <li className="chat__empty">
            <p className="muted">Pergunte sobre uma branch, uma tarefa ou quando {personName} volta. O agente responde com o que {personName} deixou registrado.</p>
          </li>
        )}
        {state.turns.map((t, i) => (
          <li key={i} className="chat__turn">
            <p className="chat__line">
              <span className="chat__who">{askerName}</span> {t.question}
            </p>
            <div className="chat__line chat__reply">
              <span className="chat__who chat__who--twin">{t.reply.agentName}</span> {t.reply.text}
              {t.reply.warnings.map((w) => (
                <p key={w} className="chat__warning">
                  Aviso: {w}
                </p>
              ))}
              {t.reply.sources.length > 0 && (
                <ul className="sources" role="list" aria-label="Fontes">
                  {t.reply.sources.map((s) => (
                    <li key={s.ref} className="pill-source mono">
                      Fonte: {s.label}
                    </li>
                  ))}
                </ul>
              )}
              {t.reply.needsOwner && <p className="mono muted chat__meta">Entra no plano da manhã de {personName}</p>}
            </div>
          </li>
        ))}
        {pending && asking && (
          <li className="chat__turn">
            <p className="chat__line">
              <span className="chat__who">{askerName}</span> {asking}
            </p>
            <p className="chat__line chat__reply chat__typing">
              <span className="chat__who chat__who--twin">{agent}</span>
              <span className="muted">consultando a nota do dia e os registros</span>
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </p>
          </li>
        )}
      </ol>

      <form
        action={action}
        className="ask-form"
        onSubmit={() => {
          setAsking(question.trim());
          setTimeout(() => setQuestion(""), 0);
        }}
      >
        <input type="hidden" name="pessoa" value={personId} />
        <label htmlFor="pergunta" className="mono muted">
          Sua pergunta para o agente
        </label>
        <div className="ask-form__row">
          <input
            ref={input}
            id="pergunta"
            name="pergunta"
            className="field"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={`@${personName} posso seguir com…`}
            maxLength={500}
            autoComplete="off"
            required
          />
          <button type="submit" className="button-app-primary" disabled={pending || !question.trim()}>
            {pending ? "Consultando" : "Perguntar"}
          </button>
        </div>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
      </form>

      {suggestions.length > 0 && (
        <div className="suggestions">
          <span className="mono muted">Experimente</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="chip-button"
              onClick={() => {
                setQuestion(s);
                input.current?.focus();
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </ProductWindow>
  );
}
