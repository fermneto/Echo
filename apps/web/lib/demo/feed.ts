/**
 * O que aconteceu à noite e o que espera decisão, na história da demo (docs/produto.md).
 * SINTÉTICO até os fluxos F2, F4 e F5 da Frente 2 gravarem `agent_runs` e o plano da manhã.
 */

export type NightEntry = {
  /** Hora UTC do evento; a tela mostra no fuso de quem é o agente. */
  at: string;
  personId: string;
  text: string;
  ref?: string;
};

export const NIGHT_LOG: readonly NightEntry[] = [
  { at: "2026-11-06T07:02:00Z", personId: "yan", text: "respondeu Eduardo sobre a ECH-140, com aviso de nota do dia não confirmada.", ref: "ECH-140" },
  { at: "2026-11-06T06:15:00Z", personId: "fernando", text: "não liberou a ech-128-tempo-limite: reservada na nota do dia. A dúvida foi para o plano da manhã.", ref: "ech-128" },
  { at: "2026-11-06T06:12:00Z", personId: "fernando", text: "liberou a ech-131-api-v2 para Eduardo, com a nota do dia confirmada como fonte.", ref: "ech-131" },
  { at: "2026-11-06T05:40:00Z", personId: "fernando", text: "analisou o PR da ECH-128 durante a noite e deixou uma correção pronta para aprovação.", ref: "PR 41" },
];

export type WaitingItem = {
  id: string;
  /** Quem decide. */
  ownerId: string;
  text: string;
  since: string;
  leaderOnly?: boolean;
};

export const WAITING: readonly WaitingItem[] = [
  { id: "PR 41", ownerId: "fernando", text: "Correção preparada no PR da ECH-128, esperando aprovação", since: "esta noite" },
  { id: "ech-128", ownerId: "fernando", text: "Eduardo perguntou se pode mexer na ech-128-tempo-limite", since: "03:15 FOR" },
  { id: "PR 34", ownerId: "eduardo", text: "Revisão do PR 34, de Carla", since: "há 2 dias" },
  { id: "Férias", ownerId: "marina", text: "Plano para as férias de Bruno, de 10 a 21/11", since: "hoje", leaderOnly: true },
];
