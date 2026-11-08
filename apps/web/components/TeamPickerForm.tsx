"use client";

import { useState, useTransition } from "react";
import { acompanharEquipes } from "@/app/(painel)/equipes-actions";

/** Salva ao marcar ou desmarcar. O botão só existe sem JavaScript. */
export function TeamPickerForm({ teams, visible, back }: { teams: { id: string; name: string }[]; visible: string[]; back: string }) {
  const [chosen, setChosen] = useState(visible);
  const [pending, startTransition] = useTransition();

  return (
    <form action={acompanharEquipes} className="team-picker" aria-label="Equipes que você acompanha" aria-busy={pending}>
      <input type="hidden" name="voltar" value={back} />
      <span className="team-picker__label label-caps">Equipes que você acompanha</span>
      <ul className="team-picker__list" role="list">
        {teams.map((t) => (
          <li key={t.id}>
            <label className="team-picker__item">
              <input
                type="checkbox"
                name="equipe"
                value={t.id}
                checked={chosen.includes(t.id)}
                onChange={(e) => {
                  setChosen((now) => (e.target.checked ? [...now, t.id] : now.filter((id) => id !== t.id)));
                  const data = new FormData(e.target.form!);
                  startTransition(() => acompanharEquipes(data));
                }}
              />{" "}
              {t.name}
            </label>
          </li>
        ))}
      </ul>
      <noscript>
        <button type="submit" className="button-outline">
          Acompanhar
        </button>
      </noscript>
    </form>
  );
}
