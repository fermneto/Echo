import type { AvatarTraits, PersonRole } from "@echo/domain";

/**
 * Opções e estado do cadastro do RH que o formulário (componente de cliente) usa. Sem dependência de
 * servidor: a leitura do PDF fica em onboarding-form.ts.
 */

export { ZONES } from "./zones";

export const ROLE_OPTIONS: readonly { value: PersonRole; label: string }[] = [
  { value: "member", label: "Pessoa da equipe" },
  { value: "leader", label: "Liderança" },
  { value: "hr", label: "RH" },
];

export const PHOTO_ACCEPT = "image/png,image/jpeg,image/webp";
export const RESUME_ACCEPT = ".pdf,.txt,.md,application/pdf,text/plain,text/markdown";

export type CadastroState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | {
      status: "done";
      /** Id da pessoa criada, para o link da ficha (sem ele, nada foi gravado: pré-visualização da demo). */
      personId?: string;
      name: string;
      avatar: AvatarTraits;
      jobTitle: string | null;
      skills: string[];
      areas: string[];
      languages: string[];
      /** Frases curtas sobre o que veio do modelo e o que ficou por regra. */
      notes: string[];
      saved: boolean;
    };
