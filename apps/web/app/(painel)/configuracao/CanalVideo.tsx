"use client";

import { useActionState } from "react";
import type { CanalVideoState } from "./actions";
import type { VideoChannelRow } from "@/lib/video-channel";

type Action = (prev: CanalVideoState, form: FormData) => Promise<CanalVideoState>;

/**
 * Canal do vídeo da semana, por equipe e o de reserva da empresa. Cola o id `C…` ou escolhe entre os canais onde
 * o Echo já respondeu (sugestões, sem precisar de escopo para listar canais). Vazio tira o canal.
 */
export function CanalVideo({ action, rows, suggestions }: { action: Action; rows: readonly VideoChannelRow[]; suggestions: readonly string[] }) {
  return (
    <div className="video-channels">
      {suggestions.length ? (
        <datalist id="video-canais">
          {suggestions.map((c) => (
            <option key={c} value={c}>
              Canal onde o Echo já respondeu
            </option>
          ))}
        </datalist>
      ) : null}
      {rows.map((r) => (
        <Row key={r.target} action={action} row={r} hasSuggestions={suggestions.length > 0} />
      ))}
    </div>
  );
}

function Row({ action, row, hasSuggestions }: { action: Action; row: VideoChannelRow; hasSuggestions: boolean }) {
  const [state, submit, pending] = useActionState(action, { status: "idle" } as CanalVideoState);
  const id = `canal-${row.target}`;
  return (
    <form action={submit} className="video-channels__row">
      <input type="hidden" name="alvo" value={row.target} />
      <label htmlFor={id} className="video-channels__label">
        <span className="video-channels__name">{row.label}</span>
        <span className="muted video-channels__hint">{row.hint}</span>
      </label>
      <input
        id={id}
        className="field mono video-channels__input"
        name="canal"
        defaultValue={state.status === "done" ? (state.channel ?? "") : (row.channel ?? "")}
        placeholder="C0123ABCD45"
        pattern="[Cc][A-Za-z0-9]{8,12}"
        title="Id do canal público do Slack, começando com C"
        autoComplete="off"
        spellCheck={false}
        {...(hasSuggestions ? { list: "video-canais" } : {})}
      />
      <button type="submit" className="button-app-primary" disabled={pending}>
        {pending ? "Gravando…" : "Salvar"}
      </button>
      {state.status === "error" ? (
        <p className="onboard__error video-channels__msg" role="alert">
          {state.error}
        </p>
      ) : state.status === "done" ? (
        <p className="muted video-channels__msg" role="status">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
