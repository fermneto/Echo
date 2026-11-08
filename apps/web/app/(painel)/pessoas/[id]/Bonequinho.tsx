"use client";

import type { AvatarTraits } from "@echo/domain";
import { useActionState, useState } from "react";
import { PixelSprite } from "@/components/PixelSprite";
import { type BonequinhoState, TRAIT_FIELDS, traitOptions } from "@/lib/avatar-form";

type Action = (prev: BonequinhoState, form: FormData) => Promise<BonequinhoState>;

/**
 * Trocar o bonequinho na ficha: por uma foto nova (Claude escolhe os traços) ou à mão. É o mesmo desenho que
 * vai como ícone do agente no Slack. Fechado até alguém abrir.
 */
export function Bonequinho({ redo, adjust, personId, name, initial }: { redo: Action; adjust: Action; personId: string; name: string; initial: AvatarTraits }) {
  const [redoState, submitRedo, redoing] = useActionState(redo, { status: "idle" } as BonequinhoState);
  const [adjustState, submitAdjust, adjusting] = useActionState(adjust, { status: "idle" } as BonequinhoState);
  // O último que salvou manda no desenho e nos campos.
  const [last, setLast] = useState<"redo" | "adjust">("redo");
  const saved = last === "redo" ? redoState : adjustState;
  const traits = saved.status === "saved" ? saved.traits : redoState.status === "saved" ? redoState.traits : adjustState.status === "saved" ? adjustState.traits : initial;
  // Prévia do ajuste à mão, antes de salvar.
  const [draft, setDraft] = useState<AvatarTraits | null>(null);
  const shown = draft ?? traits;
  const status = last === "redo" ? redoState : adjustState;
  const open = redoState.status !== "idle" || adjustState.status !== "idle";

  return (
    <details className="card avatar-edit" open={open}>
      <summary className="card__title profile-edit__summary">Trocar o bonequinho</summary>
      <div className="avatar-edit__body">
        <div className="avatar-edit__stage">
          <PixelSprite look={shown} mode="person" size={112} label={`Bonequinho de ${name}`} />
        </div>

        <form action={submitRedo} onSubmit={() => (setLast("redo"), setDraft(null))} className="avatar-edit__photo">
          <input type="hidden" name="pessoa" value={personId} />
          <label className="profile-edit__field">
            <span className="field-row__k mono">Foto nova</span>
            <input className="field onboard__file" type="file" name="foto" accept="image/png,image/jpeg,image/webp" required />
          </label>
          <button type="submit" className="button-app-primary" disabled={redoing || adjusting}>
            {redoing ? "Lendo a foto…" : "Refazer pela foto"}
          </button>
        </form>

        <form action={submitAdjust} onSubmit={() => (setLast("adjust"), setDraft(null))} className="avatar-edit__traits" key={JSON.stringify(traits)}>
          <input type="hidden" name="pessoa" value={personId} />
          <p className="field-row__k mono avatar-edit__or">Ou ajuste à mão</p>
          <div className="avatar-edit__grid">
            {TRAIT_FIELDS.map((f) => (
              <label key={f.key} className="profile-edit__field">
                <span className="field-row__k mono">{f.label}</span>
                <select className="field" name={f.key} defaultValue={traits[f.key]} onChange={(e) => setDraft({ ...(draft ?? traits), [f.key]: e.target.value })}>
                  {traitOptions(f.key).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button type="submit" className="button-outline" disabled={redoing || adjusting}>
            {adjusting ? "Salvando…" : "Salvar ajuste"}
          </button>
        </form>

        <p className="profile-edit__status" role="status">
          {status.status === "error" ? status.error : status.status === "saved" ? status.note : draft ? "Prévia: salve para trocar no painel e no Slack." : ""}
        </p>
      </div>
      <p className="card__foot">A foto fica só neste pedido e vira traços de uma lista fechada, sem gênero, idade ou origem.</p>
    </details>
  );
}
