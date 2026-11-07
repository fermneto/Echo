/**
 * Plano da manhã de cada pessoa (F5), SINTÉTICO. A ordem sugerida vem de regra: primeiro quem
 * está esperando, depois correções prontas, depois prazos. No máximo 7 itens.
 */

export type PlanItem = { id: string; title: string; why: string; kind: "esperando" | "correção" | "revisão" | "prazo" };

const PLANS: Record<string, PlanItem[]> = {
  fernando: [
    { id: "ech-128-pergunta", title: "Eduardo perguntou se pode mexer na ech-128-tempo-limite", why: "O agente não liberou: a branch está reservada. Ele espera a sua resposta desde as 03:15.", kind: "esperando" },
    { id: "pr-41", title: "Correção pronta no PR 41 (ech-128-tempo-limite)", why: "A revisão noturna deixou a correção numa versão separada. Nada foi aprovado.", kind: "correção" },
    { id: "pr-34", title: "Revisar o PR 34, de Carla", why: "Aberto há 2 dias, esperando a primeira revisão.", kind: "revisão" },
    { id: "ech-128", title: "ECH-128: tratar tempo limite na integração de pagamentos", why: "O prazo vence nesta sexta.", kind: "prazo" },
  ],
  eduardo: [{ id: "pr-34", title: "Revisar o PR 34, de Carla", why: "Aberto há 2 dias, esperando a primeira revisão.", kind: "revisão" }],
  marina: [{ id: "ferias-bruno", title: "Plano para as férias de Bruno (10 a 21/11)", why: "Montado por regra, respeitando áreas e carga. Nada muda até você aprovar.", kind: "esperando" }],
};

export function planFor(id: string): PlanItem[] {
  return PLANS[id] ?? [];
}

/** Move um item uma posição para cima (-1) ou para baixo (+1). */
export function move<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}
