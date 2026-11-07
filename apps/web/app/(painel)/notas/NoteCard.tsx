"use client";

import { useActionState, useEffect, useState } from "react";
import { latest, MAX_NOTE, type Note } from "@/lib/demo/notes";
import { editarNota, type EditState } from "./actions";

/** Uma nota do cérebro: texto atual, histórico de versões e correção no lugar. */
export function NoteCard({ note, path }: { note: Note; path: string }) {
  const v = latest(note);
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const [state, action, pending] = useActionState<EditState, FormData>(editarNota, {});

  useEffect(() => {
    if (state.saved) setEditing(false);
  }, [state.saved]);

  return (
    <article className="note" aria-labelledby={`nota-${note.id}`}>
      <p className="mono muted note__path">{path}</p>
      <h3 id={`nota-${note.id}`} className="note__title">
        {note.title}
      </h3>

      {editing ? (
        <form action={action} className="note__form">
          <input type="hidden" name="id" value={note.id} />
          <label className="sr-only" htmlFor={`texto-${note.id}`}>
            Texto da nota
          </label>
          <textarea id={`texto-${note.id}`} name="texto" className="field note__textarea" defaultValue={v.body} maxLength={MAX_NOTE} autoFocus />
          {state.error && (
            <p className="note__error" role="alert">
              {state.error}
            </p>
          )}
          <div className="note__actions">
            <button type="submit" className="button-pill" disabled={pending}>
              {pending ? "Salvando…" : "Salvar versão nova"}
            </button>
            <button type="button" className="button-outline" onClick={() => setEditing(false)} disabled={pending}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <p className="note__body">{v.body}</p>
      )}

      <div className="note__meta">
        {note.tags.map((t) => (
          <span key={t} className="chip mono">
            {t}
          </span>
        ))}
        <span className={`chip mono${v.n > 1 ? " is-on" : ""}`}>
          {v.n > 1 && <span className="dot dot--on" aria-hidden="true" />}
          Versão {v.n} · {v.n > 1 ? `corrigida por ${v.by}` : v.by} · {v.at}
        </span>
      </div>

      {!editing && (
        <div className="note__actions">
          <button type="button" className="link-button mono" onClick={() => setEditing(true)}>
            CORRIGIR
          </button>
          {note.versions.length > 1 && (
            <button type="button" className="link-button mono" aria-expanded={history} onClick={() => setHistory((h) => !h)}>
              {history ? "ESCONDER VERSÕES" : `VER ${note.versions.length} VERSÕES`}
            </button>
          )}
        </div>
      )}

      {history && (
        <ol className="note__history" reversed>
          {[...note.versions].reverse().map((h) => (
            <li key={h.n}>
              <span className="mono muted">
                v{h.n} · {h.by} · {h.at}
              </span>
              <span className={h.n === v.n ? "" : "note__old"}>{h.body}</span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
