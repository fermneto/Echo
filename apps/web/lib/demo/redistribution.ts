/**
 * Plano de redistribuição (F6), SINTÉTICO. No produto, sai de planOptions (packages/domain):
 * áreas e folga decidem, o modelo só redige. Nada muda até a liderança aprovar.
 */

export type Assignment = { item: string; title: string; to: string; reason: string };

export const ABSENCE = { personId: "bruno", kind: "Férias", from: "10/11", to: "21/11" } as const;

export const PLAN: readonly Assignment[] = [
  { item: "ECH-133", title: "Corrigir arredondamento em faturas", to: "Carla", reason: "Atua em pagamentos e tem folga." },
  { item: "ECH-137", title: "Exportar faturas em CSV", to: "Eduardo", reason: "Sem área definida; escolhido pela folga." },
  { item: "PR 36", title: "Revisão do PR 36", to: "Fernando", reason: "Revisor com mais folga na equipe. Fica no GitHub." },
];

export const UNASSIGNED = { item: "ECH-160", title: "Alerta de falha no webhook de pagamentos", suggestion: "Carla", reason: "Atua em pagamentos; a folga dela cabe mais esta tarefa." } as const;
