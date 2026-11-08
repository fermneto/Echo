"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AskState } from "@/lib/ask";
import { AskField } from "./AskField";
import { RevealText } from "./RevealText";
import { ProductWindow } from "./ProductWindow";

const INITIAL: AskState = { turns: [] };

/**
 * Conversa com um agente no painel: o gêmeo de uma pessoa ou o Echo da equipe.
 * A pergunta aparece na hora e o agente fica "consultando" até a resposta chegar.
 */
export function AskPanel({
  ask,
  title,
  footer,
  agent,
  ownerName,
  hidden,
  askerName,
  empty,
  placeholder,
  suggestions,
}: {
  ask: (prev: AskState, form: FormData) => Promise<AskState>;
  title: string;
  footer?: string;
  /** Nome de quem responde enquanto consulta ("Agente de Fernando", "Echo"). */
  agent: string;
  /** Dono do plano da manhã, quando a resposta manda a dúvida para ele. */
  ownerName?: string;
  hidden?: Record<string, string>;
  askerName: string;
  empty?: string;
  placeholder: string;
  suggestions: string[];
}) {
  const [state, action, pending] = useActionState(ask, INITIAL);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!pending) setAsking("");
  }, [pending]);

  return (
    <ProductWindow title={title} {...(footer ? { footer } : {})}>
      <ol className="chat" aria-live="polite" aria-busy={pending}>
        {empty && state.turns.length === 0 && !pending && (
          <li className="chat__empty">
            <p className="muted">{empty}</p>
          </li>
        )}
        {state.turns.map((t, i) => (
          <li key={i} className="chat__turn">
            <p className="chat__line">
              <span className="chat__who">{askerName}</span> {t.question}
            </p>
            <div className="chat__line chat__reply">
              <span className="chat__who chat__who--twin">{t.reply.agentName}</span> <RevealText text={t.reply.text} animate={i === state.turns.length - 1} />
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
              {t.reply.needsOwner && ownerName && <p className="mono muted chat__meta">Entra no plano da manhã de {ownerName}</p>}
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
              <span className="muted">consultando os registros</span>
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
        ref={form}
        action={action}
        className="ask-form"
        onSubmit={() => {
          setAsking(question.trim());
          setTimeout(() => setQuestion(""), 0);
        }}
      >
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <AskField
          id="pergunta"
          name="pergunta"
          label="Sua pergunta para o agente"
          value={question}
          onChange={setQuestion}
          placeholder={placeholder}
          pending={pending}
          loadingText={`${agent} está consultando os registros…`}
          inputRef={input}
        />
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
              disabled={pending}
              onClick={() => {
                // A sugestão já vai como pergunta: preenche o campo e envia.
                flushSync(() => setQuestion(s));
                form.current?.requestSubmit();
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
