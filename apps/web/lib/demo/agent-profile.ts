// "Seu agente" na demonstração (sem banco), SINTÉTICO: decisões de exemplo e o texto da pessoa guardado só no
// navegador de quem visita (cookie), como as edições de nota.

/** O que o agente fez com uma correção, pela delegação (mesmo formato de @echo/agents/perfil, com a data em ISO). */
export type DecisionView = {
  fixId: string;
  repository: string;
  prNumber: number;
  draftPrNumber: number | null;
  outcome: "unida" | "esperando_ci" | "com_voce";
  state: string;
  note: string;
  atIso: string;
};

const DEMO_DECISIONS: Record<string, DecisionView[]> = {
  fernando: [
    { fixId: "demo-f41", repository: "echo-teste/app", prNumber: 41, draftPrNumber: 48, outcome: "com_voce", state: "ready", note: "Ficou com você: caminho sensível: src/pagamentos/tempo-limite.ts.", atIso: "2026-11-07T06:10:00Z" },
    { fixId: "demo-f37", repository: "echo-teste/app", prNumber: 37, draftPrNumber: 39, outcome: "unida", state: "applied", note: "Unida pela sua delegação de 05/11: correção pequena da revisão noturna, testes passando.", atIso: "2026-11-06T06:20:00Z" },
  ],
  eduardo: [
    { fixId: "demo-e52", repository: "echo-teste/app", prNumber: 52, draftPrNumber: 53, outcome: "unida", state: "applied", note: "Unida pela sua delegação de 06/11: ajuste de validação em 1 arquivo, testes passando.", atIso: "2026-11-07T06:05:00Z" },
    { fixId: "demo-e49", repository: "echo-teste/app", prNumber: 49, draftPrNumber: 50, outcome: "com_voce", state: "ready", note: "Ficou com você: a delegação pede para ser consultado em mudança de regra de negócio.", atIso: "2026-11-06T06:15:00Z" },
  ],
};

export function demoDecisions(personaId: string): DecisionView[] {
  return DEMO_DECISIONS[personaId] ?? [];
}

export const PROFILE_COOKIE = "echo_seu_agente";

export type DemoProfile = { style: string; delegation: string; delegationAtIso: string | null };

/** Lê o cookie da demo; qualquer formato estranho vira perfil vazio. */
export function parseProfile(raw: string | undefined): DemoProfile {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<DemoProfile>) : {};
    return {
      style: typeof v.style === "string" ? v.style : "",
      delegation: typeof v.delegation === "string" ? v.delegation : "",
      delegationAtIso: typeof v.delegationAtIso === "string" ? v.delegationAtIso : null,
    };
  } catch {
    return { style: "", delegation: "", delegationAtIso: null };
  }
}
