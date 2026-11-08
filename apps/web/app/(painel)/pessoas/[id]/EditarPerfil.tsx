"use client";

import { useActionState, useState } from "react";
import type { PerfilState, ProfileInput } from "@/lib/profile-form";

/** Edição do perfil na ficha: cargo, habilidades, áreas e idiomas. Fechada até alguém abrir. */
export function EditarPerfil({ action, personId, initial, open }: { action: (prev: PerfilState, form: FormData) => Promise<PerfilState>; personId: string; initial: ProfileInput; open: boolean }) {
  const [state, submit, pending] = useActionState(action, { status: "idle" } as PerfilState);
  // Começa aberta só se o perfil está vazio; depois de salvar, continua aberta para mostrar o aviso.
  const [startOpen] = useState(open);
  const v = state.status === "saved" ? state.profile : initial;

  return (
    <details className="card profile-edit" open={startOpen || state.status !== "idle"}>
      <summary className="card__title profile-edit__summary">Editar perfil</summary>
      <form action={submit} className="profile-edit__form" key={state.status === "saved" ? JSON.stringify(v) : "form"}>
        <input type="hidden" name="pessoa" value={personId} />
        <label className="profile-edit__field">
          <span className="field-row__k mono">Cargo</span>
          <input className="field" name="cargo" defaultValue={v.jobTitle ?? ""} maxLength={60} autoComplete="off" />
        </label>
        <label className="profile-edit__field">
          <span className="field-row__k mono">Habilidades, separadas por vírgula</span>
          <textarea className="field" name="habilidades" rows={2} defaultValue={v.skills.join(", ")} />
        </label>
        <label className="profile-edit__field">
          <span className="field-row__k mono">Áreas de atuação</span>
          <input className="field" name="areas" defaultValue={v.areas.join(", ")} autoComplete="off" />
        </label>
        <label className="profile-edit__field">
          <span className="field-row__k mono">Idiomas</span>
          <input className="field" name="idiomas" defaultValue={v.languages.join(", ")} autoComplete="off" />
        </label>
        <div className="profile-edit__actions">
          <button type="submit" className="button-app-primary" disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
          <p className="profile-edit__status" role="status">
            {state.status === "error"
              ? state.error
              : state.status === "saved"
                ? state.dropped
                  ? `Salvo. ${state.dropped === 1 ? "Um item ficou de fora" : `${state.dropped} itens ficaram de fora`}: repetido, longo demais ou com dado pessoal.`
                  : "Salvo."
                : ""}
          </p>
        </div>
      </form>
      <p className="card__foot">O gêmeo usa esse perfil para saber com o que a pessoa trabalha. E-mail, telefone, documentos e links não entram.</p>
    </details>
  );
}
