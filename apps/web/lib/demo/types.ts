import type { Person, PersonRole } from "@echo/domain";

/**
 * Tipos do painel em cima dos contratos de `@echo/domain` e `@echo/agents`.
 * Só o que é de exibição (cidade, história da demo) e o estado provisório de disponibilidade ficam aqui.
 */

export type Role = PersonRole;

/** Estado de disponibilidade no instante da demo. Provisório até `isAway` (packages/domain) ser implementado. */
export type Availability =
  | { kind: "working" }
  | { kind: "off"; returns: string }
  | { kind: "vacation"; until: string };

export type Persona = Person & {
  /** Uma linha: a função da pessoa. */
  title: string;
  /** O papel dela na história da demo. */
  story: string;
  city: string;
  /** Código curto da cidade para o mono ("FOR 03:12"). */
  cityCode: string;
  availability: Availability;
};
