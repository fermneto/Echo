"use client";

import { type FormEvent, useActionState, useTransition } from "react";
import { AccountFields, type AccountValues } from "@/components/AccountFields";
import type { ContasState } from "@/lib/accounts-state";

/**
 * Contas da pessoa no Slack, GitHub e Linear, na ficha. Só o RH e a liderança da equipe veem. Aberta quando
 * falta a conta do Slack: sem ela, a pessoa existe só no painel.
 */
export function ContasPessoa({ action, personId, name, initial, slackMembers }: { action: (prev: ContasState, form: FormData) => Promise<ContasState>; personId: string; name: string; initial: AccountValues; slackMembers: readonly { id: string; name: string }[] | null }) {
  const [state, submit, pending] = useActionState(action, { status: "idle" } as ContasState);
  const [, startTransition] = useTransition();
  // Sem o `action` do form: num erro, o que foi digitado continua no campo.
  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(() => submit(data));
  };
  const v = state.status === "saved" ? state.values : initial;
  const slackName = v.slack ? (slackMembers?.find((m) => m.id === v.slack)?.name ?? v.slack) : null;

  return (
    <details className="card profile-edit" open={!v.slack || state.status !== "idle"}>
      <summary className="card__title profile-edit__summary">Contas nas plataformas</summary>
      <p className={v.slack ? "muted" : "profile-accounts__warn"} role={v.slack ? undefined : "note"}>
        {v.slack ? `Slack: ${slackName}.` : `Sem conta do Slack: ${name} existe só no painel. Não entra pelo login, não é reconhecida nas menções e não recebe nada no privado.`}
      </p>
      <form onSubmit={send} className="profile-edit__form" key={state.status === "saved" ? JSON.stringify(v) : "form"}>
        <input type="hidden" name="pessoa" value={personId} />
        <AccountFields slackMembers={slackMembers} initial={v} className="profile-edit__field" />
        <div className="profile-edit__actions">
          <button type="submit" className="button-app-primary" disabled={pending}>
            {pending ? "Salvando…" : "Salvar contas"}
          </button>
          <p className="profile-edit__status" role="status">
            {state.status === "error" ? state.error : state.status === "saved" ? "Contas salvas." : ""}
          </p>
        </div>
      </form>
      <p className="card__foot">Campo vazio tira a conta daquela plataforma. A mesma conta não fica com duas pessoas. Quem trocou fica registrado.</p>
    </details>
  );
}
