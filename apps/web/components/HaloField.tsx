"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

const CLEAR_MS = 520;

/** Texto em que cada letra entra com um pequeno atraso. Remonta pela `key` para tocar de novo. */
function Stagger({ text, className, step = 18 }: { text: string; className: string; step?: number }) {
  return (
    <span className={className} aria-hidden="true">
      {Array.from(text, (c, i) => (
        <span key={i} style={{ animationDelay: `${i * step}ms` }}>
          {c === " " ? " " : c}
        </span>
      ))}
    </span>
  );
}

/**
 * Campo de pergunta: parado, só o ponto verde do "echo."; consultando, o contorno ecoa para
 * fora e o ponto vira medidor; ao responder, um último eco verde. Placeholder que entra
 * letra a letra e texto que se desfaz ao limpar. Tudo em CSS, desligado com movimento reduzido.
 */
export function HaloField({
  id,
  name,
  value,
  onChange,
  placeholder,
  pending,
  loadingText,
  inputRef,
  label,
  maxLength = 500,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  pending: boolean;
  loadingText: string;
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  maxLength?: number;
}) {
  const [typing, setTyping] = useState(false);
  const [ghost, setGhost] = useState<{ text: string; key: number } | null>(null);
  const [placeholderKey, setPlaceholderKey] = useState(0);
  const [answered, setAnswered] = useState(0);
  const wasPending = useRef(false);
  const typingTimer = useRef<number | null>(null);
  const ghostTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (wasPending.current && !pending) setAnswered((n) => n + 1);
    wasPending.current = pending;
  }, [pending]);

  const dissolve = (text: string) => {
    if (!text) return;
    if (ghostTimer.current) clearTimeout(ghostTimer.current);
    setGhost({ text, key: Date.now() });
    ghostTimer.current = window.setTimeout(() => {
      setGhost(null);
      setPlaceholderKey((k) => k + 1);
    }, CLEAR_MS + Math.min(text.length, 40) * 8);
  };

  const state = pending ? "is-busy" : typing ? "is-typing" : ghost ? "is-clearing" : "";
  const empty = !value && !ghost && !pending;

  return (
    <div className={`halo ${state}`}>
      {/* O eco só aparece quando algo acontece: ondas enquanto consulta e uma verde quando responde. */}
      <div className="halo__echo" aria-hidden="true">
        {pending && [0, 1].map((k) => <span key={k} className="halo__ring" style={{ "--k": k } as CSSProperties} />)}
        {answered > 0 && <span key={answered} className="halo__ring halo__ring--done" />}
      </div>
      <div className="halo__field" aria-busy={pending || undefined}>
        {/* O ponto do "echo." como medidor: acende de baixo para cima no ritmo do eco. */}
        <span className="halo__meter" aria-hidden="true">
          {[4, 3, 2, 1].map((k) => (
            <span key={k} className="halo__cell" style={{ "--k": k } as CSSProperties} />
          ))}
          <span className="halo__cell is-on" />
        </span>
        <div className="halo__input-wrap">
          <label htmlFor={id} className="sr-only">
            {label}
          </label>
          <input
            ref={inputRef}
            id={id}
            name={name}
            className={`halo__input${pending || ghost ? " is-hidden" : ""}`}
            value={value}
            onChange={(e) => {
              const next = e.target.value;
              if (!next && value) dissolve(value);
              onChange(next);
              if (typingTimer.current) clearTimeout(typingTimer.current);
              setTyping(true);
              typingTimer.current = window.setTimeout(() => setTyping(false), 420);
            }}
            readOnly={pending}
            maxLength={maxLength}
            autoComplete="off"
            required
          />
          {empty && <Stagger key={`p${placeholderKey}`} text={placeholder} className="halo__placeholder" />}
          {pending && <Stagger key="loading" text={loadingText} className="halo__placeholder halo__placeholder--loading" step={38} />}
          {ghost && (
            <span key={ghost.key} className="halo__ghost" aria-hidden="true">
              {Array.from(ghost.text).map((c, i, all) => (
                <span key={i} style={{ animationDelay: `${Math.min((all.length - 1 - i) * 12, 420)}ms` }}>
                  {c === " " ? " " : c}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="halo__trail">
          {pending ? (
            <span className="halo__spinner" aria-hidden="true" />
          ) : (
            value && (
              <button
                type="button"
                className="halo__clear"
                aria-label="Limpar a pergunta"
                onClick={() => {
                  dissolve(value);
                  onChange("");
                  inputRef.current?.focus();
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )
          )}
          <button type="submit" className="halo__send" disabled={pending || !value.trim()} aria-label={pending ? "Consultando" : "Perguntar"}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
