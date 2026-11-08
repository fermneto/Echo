/**
 * Plano da manhã de cada pessoa (F5), SINTÉTICO. A ordem sugerida vem de regra: primeiro quem
 * está esperando, depois correções prontas, depois prazos. No máximo 7 itens.
 */

export type PlanItem = {
  id: string;
  title: string;
  why: string;
  kind: "esperando" | "correção" | "revisão" | "prazo";
  /** A ação principal do item: abrir onde se resolve, ou aprovar ali mesmo. */
  action?: { label: string; href?: string; done?: string };
  /** Prazo (AAAA-MM-DD): o motivo é escrito em relação a hoje, na tela. */
  dueIso?: string;
  /** Correção real (fix_runs): aprovar ou recusar passa pelo fluxo da correção, com a aprovação registrada. */
  fixId?: string;
};

const PLANS: Record<string, PlanItem[]> = {
  fernando: [
    { id: "ech-128-pergunta", title: "Eduardo perguntou se pode mexer na ech-128-tempo-limite", why: "O agente não liberou: a branch está reservada. Ele espera a sua resposta desde as 03:15.", kind: "esperando", action: { label: "Responder a Eduardo", href: "/pessoas/eduardo" } },
    { id: "pr-41", title: "Correção pronta no PR 41 (ech-128-tempo-limite)", why: "A revisão noturna deixou a correção numa versão separada. Nada foi aprovado. Ficou com você: caminho sensível: src/pagamentos/tempo-limite.ts.", kind: "correção", action: { label: "Aprovar a correção", done: "Correção aprovada por você: vira um PR em rascunho para revisão." } },
    { id: "pr-34", title: "Revisar o PR 34, de Carla", why: "Aberto há 2 dias, esperando a primeira revisão.", kind: "revisão" },
    { id: "ech-128", title: "ECH-128: tratar tempo limite na integração de pagamentos", why: "", kind: "prazo", dueIso: "2026-11-06" },
  ],
  eduardo: [
    { id: "pr-49", title: "Correção pronta no PR 49", why: "A revisão noturna deixou a correção numa versão separada. Nada foi aprovado. Ficou com você: a delegação pede para ser consultado em mudança de regra de negócio.", kind: "correção", action: { label: "Aprovar a correção", done: "Correção aprovada por você: vira um PR em rascunho para revisão." } },
    { id: "pr-34", title: "Revisar o PR 34, de Carla", why: "Aberto há 2 dias, esperando a primeira revisão.", kind: "revisão" },
  ],
  marina: [
    {
      id: "ferias-bruno",
      title: "Plano para as férias de Bruno (10 a 21/11)",
      why: "Montado por regra, respeitando áreas e carga. Nada muda até você aprovar.",
      kind: "esperando",
      action: { label: "Revisar o plano", href: "/redistribuicao" },
    },
  ],
};

export function planFor(id: string): PlanItem[] {
  return PLANS[id] ?? [];
}
