"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { dayMonth, MAX_ITEM, MAX_ITEMS, type NoteSections, type NoteView, SECTION_KEYS, type SectionKey, STATE_LABEL } from "@/lib/daily-note";
import { confirmarNota, type ConfirmState } from "./actions";

const SECTIONS: Record<SectionKey, { title: string; empty: string; placeholder: string }> = {
  stoppedAt: { title: "Onde parou", empty: "Nada registrado.", placeholder: "ECH-128, PR 41 aberto; falta tratar o tempo limite." },
  blocked: { title: "Bloqueios", empty: "Nenhum bloqueio.", placeholder: "PR 44 aguarda revisão" },
  released: { title: "Liberado", empty: "Nada liberado.", placeholder: "ech-131-api-v2 para Eduardo: formato fechado" },
  reserved: { title: "Reservado", empty: "Nada reservado.", placeholder: "ech-128-tempo-limite: até a revisão" },
};

type Item = { key: number; text: string };
type Lists = Record<SectionKey, Item[]>;

let seq = 0;
const toLists = (s: NoteSections): Lists => Object.fromEntries(SECTION_KEYS.map((k) => [k, s[k].map((text) => ({ key: ++seq, text }))])) as Lists;

/** Rascunho do agente com as quatro listas. A pessoa corrige o que quiser e confirma. */
export function NoteEditor({ initial, ownerName, branchFormat }: { initial: NoteView; ownerName: string; branchFormat: boolean }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmarNota, {});
  const view = state.view ?? initial;
  const [lists, setLists] = useState<Lists>(() => toLists(initial.sections));
  const lastSaved = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.saved && state.saved !== lastSaved.current && state.view) {
      lastSaved.current = state.saved;
      setLists(toLists(state.view.sections));
    }
  }, [state.saved, state.view]);

  const s = STATE_LABEL[view.state];
  const confirmed = view.state === "confirmed";
  const update = (k: SectionKey, fn: (items: Item[]) => Item[]) => setLists((l) => ({ ...l, [k]: fn(l[k]) }));

  return (
    <form action={action} className="card daily" aria-labelledby="nota-titulo">
      <input type="hidden" name="data" value={view.date} />
      <div className="daily__head">
        <h2 id="nota-titulo" className="card__title daily__title">
          Nota de {dayMonth(view.date)}
        </h2>
        <p className={`chip mono report__status is-${s.tone}`} role="status">
          <span className={`dot dot--${s.tone}`} aria-hidden="true" />
          {s.label}
        </p>
      </div>
      <p className="muted daily__by">Rascunho escrito pelo Agente de {ownerName} a partir do GitHub e do Linear. Só você confirma.</p>

      <div className="daily__grid">
        {SECTION_KEYS.map((k) => {
          const def = SECTIONS[k];
          const items = lists[k];
          return (
            <fieldset key={k} className="daily__section">
              <legend className="field-row__k mono daily__legend">{def.title}</legend>
              {items.length === 0 && <p className="muted daily__empty">{def.empty}</p>}
              <ul className="daily__list" role="list">
                {items.map((it, i) => (
                  <li key={it.key} className="daily__item">
                    <input
                      className="field daily__input"
                      name={k}
                      value={it.text}
                      maxLength={MAX_ITEM}
                      placeholder={def.placeholder}
                      aria-label={`${def.title}, item ${i + 1}`}
                      onChange={(e) => update(k, (l) => l.map((x) => (x.key === it.key ? { ...x, text: e.target.value } : x)))}
                    />
                    <button type="button" className="icon-button" aria-label={`Remover item ${i + 1} de ${def.title}`} onClick={() => update(k, (l) => l.filter((x) => x.key !== it.key))}>
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
              {items.length < MAX_ITEMS && (
                <button type="button" className="link-button daily__add" onClick={() => update(k, (l) => [...l, { key: ++seq, text: "" }])}>
                  + Adicionar
                </button>
              )}
            </fieldset>
          );
        })}
      </div>

      <p className="daily__explain muted">
        Liberado é o que colegas podem seguir sem você; reservado é o que ninguém deve mexer. O seu agente usa isso para responder a quem perguntar.
        {branchFormat && " Um branch por linha, com “para Nome” e o motivo depois de dois-pontos."}
      </p>

      <div className="daily__actions">
        <button type="submit" className="button-app-primary" disabled={pending}>
          {pending ? "Confirmando…" : confirmed ? "Salvar alterações" : "Confirmar nota"}
        </button>
        {state.error ? (
          <p className="error" role="alert">
            {state.error}
          </p>
        ) : state.saved ? (
          <p className="mono muted" role="status">
            Nota confirmada. O agente já responde com ela.
          </p>
        ) : view.state === "auto_unreviewed" ? (
          <p className="mono muted">Sem revisão em 2 horas: o agente usa esta nota com aviso. Confirme para valer como sua.</p>
        ) : null}
      </div>
    </form>
  );
}
