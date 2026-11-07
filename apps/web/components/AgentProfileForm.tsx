"use client";

import { useActionState } from "react";

type State = { saved?: string; error?: string };

/**
 * Seu agente, nas suas palavras: dois textos livres, escritos só pela própria pessoa. O primeiro muda o tom das
 * respostas; o segundo diz até onde o agente decide por ela, sempre dentro dos limites fixos listados abaixo.
 */
export function AgentProfileForm({
  save,
  personId,
  firstName,
  style,
  delegation,
  delegationSince,
  maxChars,
  never,
  fixRules,
  disabled,
}: {
  save: (prev: State, form: FormData) => Promise<State>;
  personId: string;
  firstName: string;
  style: string;
  delegation: string;
  delegationSince: string | null;
  maxChars: number;
  never: readonly string[];
  fixRules: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(save, {});
  return (
    <form action={action} className="agent-profile">
      <input type="hidden" name="pessoa" value={personId} />
      <label className="agent-profile__field">
        <span className="field-row__k mono">Como seu agente responde</span>
        <span className="muted agent-profile__hint">
          Seu jeito de falar e de atuar: tom, nível de detalhe, como você costuma explicar e encaminhar as coisas. O agente responde parecido com você, mas sempre como &ldquo;Agente de {firstName}&rdquo;, nunca como você.
        </span>
        <textarea name="estilo" defaultValue={style} maxLength={maxChars} rows={5} disabled={disabled} placeholder="Por exemplo: respondo curto e direto, explico o porquê em uma frase e sempre digo qual é o próximo passo. Prefiro apontar o PR ou a tarefa em vez de resumir." />
      </label>
      <label className="agent-profile__field">
        <span className="field-row__k mono">Até onde ele decide por você</span>
        <span className="muted agent-profile__hint">
          Escreva o que o agente pode decidir sozinho no seu lugar e em que condições. O que não estiver claro aqui continua esperando você. Hoje vale para unir no seu PR a correção da revisão noturna.
          {delegationSince ? ` Versão atual salva em ${delegationSince}.` : ""}
        </span>
        <textarea name="delegacao" defaultValue={delegation} maxLength={maxChars} rows={4} disabled={disabled} placeholder="Por exemplo: pode unir no meu PR correções pequenas da revisão noturna quando os testes passarem, menos no repositório de pagamentos. Mudança de regra de negócio, me pergunte." />
      </label>
      <div className="agent-profile__limits">
        <p className="field-row__k mono">Nunca, diga o texto o que disser</p>
        <ul>
          {never.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p className="muted">{fixRules}</p>
      </div>
      <div className="agent-profile__foot">
        <button type="submit" className="button-app-primary" disabled={pending || disabled}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
        <p className="mono muted" role="status">
          {state.error ?? (state.saved ? "Salvo. Vale a partir da próxima resposta e da próxima correção." : "")}
        </p>
      </div>
    </form>
  );
}
