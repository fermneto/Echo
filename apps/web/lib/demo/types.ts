/**
 * Tipos PROVISÓRIOS do painel, até `@echo/domain` (Frente 2) publicar os contratos.
 * Quando chegarem, troque os imports deste arquivo pelos de `@echo/domain` e apague o que sobrar.
 */

export type Role = "member" | "lead" | "hr";

/** Estado de disponibilidade no instante da demo. No produto vem de `isAway` (packages/domain). */
export type Availability =
  | { kind: "working" }
  | { kind: "off"; returns: string }
  | { kind: "vacation"; until: string };

export type Persona = {
  id: string;
  name: string;
  /** Uma linha: o que a pessoa faz e o papel dela na história da demo. */
  title: string;
  story: string;
  role: Role;
  city: string;
  /** Código curto da cidade para o mono ("FOR 03:12"). */
  cityCode: string;
  timeZone: string;
  workHours: { start: string; end: string };
  areas: string[];
  availability: Availability;
};

/** Resposta do gêmeo. No produto, vem do fluxo F2 (packages/agents) já validada. */
export type TwinReply = {
  /** Sempre "Agente de <nome>", nunca a primeira pessoa do trabalhador. */
  speaker: string;
  kind: "liberada" | "reservada" | "informacao" | "barreira" | "no-expediente" | "sem-evidencia";
  text: string;
  sources: string[];
  warning?: string;
  /** A dúvida entra no plano da manhã do dono. */
  needsOwner: boolean;
};
