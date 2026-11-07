"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { PixelAvatar } from "@/components/PixelAvatar";
import type { Persona } from "@/lib/demo/types";
import { MAX_QUESTION } from "@/lib/ask";
import { type ChannelState, ECHO_TARGET, type MentionTarget, parseMention } from "@/lib/simulator";
import { enviarNoCanal } from "./actions";

const INITIAL: ChannelState = { messages: [] };

function Avatar({ persona }: { persona?: Persona }) {
  if (!persona) {
    return (
      <span className="sim__echo" aria-hidden="true">
        e
      </span>
    );
  }
  return <PixelAvatar persona={persona} size={36} decorative />;
}

/** Canal do Slack simulado: a mensagem com menção vai ao mesmo fluxo de resposta e volta com fontes. */
export function Channel({
  me,
  people,
  targets,
  suggestions,
  canAsk,
}: {
  me: Persona;
  people: Record<string, Persona>;
  targets: MentionTarget[];
  suggestions: Record<string, string[]>;
  canAsk: boolean;
}) {
  const [state, action, pending] = useActionState(enviarNoCanal, INITIAL);
  const [target, setTarget] = useState(targets[1]?.id ?? ECHO_TARGET);
  const [text, setText] = useState("");
  const [sending, setSending] = useState<{ target: string; question: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const log = useRef<HTMLOListElement>(null);
  const time = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: me.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const byId = (id: string) => targets.find((t) => t.id === id);
  const current = byId(target);

  useEffect(() => {
    if (!pending) setSending(null);
  }, [pending]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [state.messages.length, pending]);

  const mine = (t: string, question: string) => (
    <>
      <span className="sim__mention">@{byId(t)?.handle}</span> {question}
    </>
  );

  return (
    <section className="window sim" aria-label="Canal #equipe">
      <header className="window__head">
        <span># equipe</span>
        <span className="mono muted">Mesmo fluxo do Slack</span>
      </header>

      <ol ref={log} className="sim__log" aria-live="polite" aria-busy={pending}>
        {state.messages.length === 0 && !sending && <li className="sim__empty muted">Mencione um agente ou o Echo. A resposta sai do mesmo fluxo do Slack, com as fontes.</li>}
        {state.messages.map((m) => (
          <li key={m.id} className="sim__pair">
            <div className="sim__msg">
              <Avatar persona={me} />
              <div className="sim__body">
                <p className="sim__meta">
                  <span className="sim__name">{me.name}</span>
                  <time className="mono muted">{time(m.at)}</time>
                </p>
                <p className="sim__text">{mine(m.target, m.question)}</p>
              </div>
            </div>
            <div className="sim__msg">
              <Avatar persona={m.target === ECHO_TARGET ? undefined : people[m.target]} />
              <div className="sim__body">
                <p className="sim__meta">
                  <span className="sim__name chat__who--twin">{m.reply.agentName}</span>
                  <span className="tag">App</span>
                  <time className="mono muted">{time(m.at)}</time>
                </p>
                <p className="sim__text">{m.reply.text}</p>
                {m.reply.warnings.map((w) => (
                  <p key={w} className="chat__warning">
                    Aviso: {w}
                  </p>
                ))}
                {m.reply.sources.length > 0 && (
                  <ul className="sources" role="list" aria-label="Fontes">
                    {m.reply.sources.map((s) => (
                      <li key={s.ref} className="pill-source mono">
                        Fonte: {s.label}
                      </li>
                    ))}
                  </ul>
                )}
                {m.reply.needsOwner && m.target !== ECHO_TARGET && <p className="mono muted chat__meta">Entra no plano da manhã de {byId(m.target)?.handle}</p>}
              </div>
            </div>
          </li>
        ))}
        {pending && sending && (
          <li className="sim__pair">
            <div className="sim__msg">
              <Avatar persona={me} />
              <div className="sim__body">
                <p className="sim__meta">
                  <span className="sim__name">{me.name}</span>
                </p>
                <p className="sim__text">{mine(sending.target, sending.question)}</p>
              </div>
            </div>
            <p className="sim__typing chat__typing">
              <span className="chat__who chat__who--twin">{byId(sending.target)?.agent}</span>
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
        className="sim__composer"
        onSubmit={(e) => {
          const parsed = parseMention(text, targets, target);
          if (!parsed.question) {
            e.preventDefault();
            return;
          }
          setTarget(parsed.target);
          setSending(parsed);
          setTimeout(() => setText(""), 0);
        }}
      >
        <div className="sim__targets" role="radiogroup" aria-label="Quem mencionar">
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={t.id === target}
              className={`chip-button sim__target${t.id === target ? " is-active" : ""}`}
              onClick={() => setTarget(t.id)}
              disabled={!canAsk}
              title={t.away ? `${t.handle} está fora: o agente responde` : undefined}
            >
              <span className={`dot ${t.id === ECHO_TARGET ? "dot--twin" : t.away ? "dot--off" : "dot--on"}`} aria-hidden="true" />@{t.handle}
            </button>
          ))}
        </div>
        <input type="hidden" name="alvo" value={target} />
        <div className="sim__input-row">
          <label htmlFor="mensagem" className="sim__prefix mono">
            @{current?.handle}
          </label>
          <input
            id="mensagem"
            name="mensagem"
            className="field sim__input"
            value={text}
            maxLength={MAX_QUESTION}
            onChange={(e) => setText(e.target.value)}
            placeholder={canAsk ? `Mensagem para ${current?.agent ?? "o agente"}` : "O RH não pergunta aos agentes"}
            disabled={!canAsk || pending}
            autoComplete="off"
          />
          <button type="submit" className="button-app-primary sim__send" disabled={!canAsk || pending || !text.trim()}>
            Enviar
          </button>
        </div>
        {state.error && (
          <p className="error" role="alert">
            {state.error}
          </p>
        )}
      </form>

      {canAsk && (suggestions[target]?.length ?? 0) > 0 && (
        <div className="suggestions sim__suggestions">
          <span className="mono muted">Experimente</span>
          {suggestions[target]!.map((s) => (
            <button
              key={s}
              type="button"
              className="chip-button"
              disabled={pending}
              onClick={() => {
                flushSync(() => setText(s));
                form.current?.requestSubmit();
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
