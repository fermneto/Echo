"use client";

import { useActionState } from "react";
import type { DecisionView } from "@/lib/demo/agent-profile";

type State = { saved?: string; error?: string };

/** Estado atual da correção, em palavras de quem lê. */
const STATE_LABEL: Record<string, string> = {
  ready: "esperando você",
  approved: "unindo no PR",
  applied: "unida no PR",
  declined: "recusada por você",
  failed: "falhou",
};

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
  decisions,
  timezone,
  demo,
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
  /** `null`: a leitura das decisões falhou; o resto do formulário continua valendo. */
  decisions: DecisionView[] | null;
  timezone: string;
  /** Demonstração sem banco: o texto fica só neste navegador e as decisões são de exemplo. */
  demo: boolean;
}) {
  const when = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const [state, action, pending] = useActionState(save, {});
  return (
    <form action={action} className="agent-profile">
      <input type="hidden" name="pessoa" value={personId} />
      <label className="agent-profile__field">
        <span className="field-row__k mono">Como seu agente responde</span>
        <span className="muted agent-profile__hint">
          Seu jeito de falar e de atuar: tom, nível de detalhe, como você costuma explicar e encaminhar as coisas. O agente responde parecido com você, mas sempre como &ldquo;Agente de {firstName}&rdquo;, nunca como você.
        </span>
        <textarea name="estilo" defaultValue={style} maxLength={maxChars} rows={5} placeholder="Por exemplo: respondo curto e direto, explico o porquê em uma frase e sempre digo qual é o próximo passo. Prefiro apontar o PR ou a tarefa em vez de resumir." />
      </label>
      <label className="agent-profile__field">
        <span className="field-row__k mono">Até onde ele decide por você</span>
        <span className="muted agent-profile__hint">
          Escreva o que o agente pode decidir sozinho no seu lugar e em que condições. O que não estiver claro aqui continua esperando você. Hoje vale para unir no seu PR a correção da revisão noturna.
          {delegationSince ? ` Versão atual salva em ${delegationSince}.` : ""}
        </span>
        <textarea name="delegacao" defaultValue={delegation} maxLength={maxChars} rows={4} placeholder="Por exemplo: pode unir no meu PR correções pequenas da revisão noturna quando os testes passarem, menos no repositório de pagamentos. Mudança de regra de negócio, me pergunte." />
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
        <button type="submit" className="button-app-primary" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
        <p className="mono muted" role="status">
          {state.error ?? (state.saved ? (demo ? "Salvo neste navegador (demonstração)." : "Salvo. Vale a partir da próxima resposta e da próxima correção.") : "")}
        </p>
      </div>
      {demo && <p className="muted agent-profile__hint">Demonstração sem banco: o texto fica só neste navegador, e as decisões abaixo são de exemplo.</p>}

      <div className="agent-profile__decisions" aria-labelledby="decisoes-do-agente">
        <p id="decisoes-do-agente" className="field-row__k mono">
          Decisões do seu agente
        </p>
        {decisions === null ? (
          <p className="muted agent-profile__hint">Não foi possível carregar as decisões agora. O seu texto acima continua valendo e pode ser salvo.</p>
        ) : decisions.length === 0 ? (
          <p className="muted agent-profile__hint">Nenhuma ainda. Quando uma correção da revisão noturna ficar pronta, aparece aqui se o agente uniu pela sua delegação ou deixou com você, e por quê.</p>
        ) : (
          <ul role="list" className="agent-decisions">
            {decisions.map((d) => (
              <li key={d.fixId} className={`agent-decision is-${d.outcome}`}>
                <p className="agent-decision__head">
                  <span className={`status-tag mono agent-decision__tag is-${d.outcome}`}>{d.outcome === "unida" ? "Decidiu por você" : d.outcome === "esperando_ci" ? "Esperando o CI" : "Ficou com você"}</span>
                  <span>
                    PR {d.prNumber} <span className="muted">({d.repository})</span>
                  </span>
                  <span className="mono muted agent-decision__when">{when(d.atIso)}</span>
                </p>
                <p className="agent-decision__note">{d.note || (d.outcome === "unida" ? "Unida pela sua delegação." : d.outcome === "esperando_ci" ? "Esperando o CI do rascunho para decidir pela sua delegação." : "A delegação não cobriu esta correção.")}</p>
                <p className="mono muted agent-decision__state">
                  {STATE_LABEL[d.state] ?? d.state}
                  {d.outcome === "unida" ? ` · para desfazer, reverta o commit da união no PR ${d.prNumber}` : d.outcome === "esperando_ci" ? " · une sozinho se o CI do rascunho ficar verde; você também pode decidir em Meu plano" : d.state === "ready" ? ` · aprove ou recuse a correção (rascunho ${d.draftPrNumber ?? "—"}) em Meu plano` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
