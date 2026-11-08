// Personalização do agente pela própria pessoa (texto livre): como ele responde e até onde decide por ela.
// O texto muda o tom e, na delegação, só pode liberar o que as travas abaixo permitem. Nada aqui chama modelo.
import { NIGHT_RULES } from "./night.ts";

export const AGENT_PROFILE_RULES = {
  /** Limite de cada texto (estilo e delegação). Cabe no prompt sem pesar no custo. */
  maxChars: 1200,
  /** Correção que o agente pode aplicar sozinho pela delegação: pequena, testada e fora de caminho sensível. */
  delegatedFixMaxFiles: 5,
} as const;

/**
 * Texto escrito pela pessoa, limpo para entrar no prompt: sem caracteres de controle, sem `<` e `>` (não fecha
 * nem abre marcação), no máximo duas quebras seguidas e até o limite. Vazio vira null.
 */
export function cleanAgentText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
    .replace(/[<>]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, AGENT_PROFILE_RULES.maxChars)
    .trim();
  return text || null;
}

// ---------- Delegação: o que nunca sai da pessoa e o que pode, dentro das travas

/** Decisões que a delegação pode cobrir. Hoje só uma: unir a correção da revisão noturna no PR da própria pessoa. */
export type DelegableDecision = "aplicar_correcao";

/**
 * Nunca delegável, por nenhum texto: decisões que afetam outras pessoas, a produção ou números. Fica escrito aqui
 * para a tela e o juiz mostrarem o limite; o código simplesmente não tem caminho para delegar estes casos.
 */
export const NEVER_DELEGATED = [
  "aprovar ou fazer merge de PR na branch principal",
  "publicar em produção",
  "mudar responsável de tarefa ou aceitar redistribuição",
  "aceitar ou recusar proposta de colega",
  "enviar ou aprovar relatório ao RH",
  "alterar números, metas ou prazos",
] as const;

export interface DelegatedFixFacts {
  /** Arquivos que a correção muda (já conferidos: estão no PR e não são de teste). */
  files: readonly string[];
  tests: "passou" | "falhou" | "nao_rodou" | undefined;
}

export type DelegationGate = { ok: true } | { ok: false; reason: string };

/**
 * Travas fixas antes de qualquer juiz: sem delegação escrita, nada; teste que não passou, correção grande ou
 * caminho sensível (o mesmo da revisão noturna) ficam sempre com a pessoa.
 */
export function delegatedFixGate(delegation: string | null | undefined, fix: DelegatedFixFacts): DelegationGate {
  if (!cleanAgentText(delegation)) return { ok: false, reason: "sem delegação escrita" };
  if (fix.tests !== "passou") return { ok: false, reason: fix.tests === "falhou" ? "testes falharam" : "testes não rodaram" };
  if (fix.files.length === 0) return { ok: false, reason: "correção sem arquivos" };
  if (fix.files.length > AGENT_PROFILE_RULES.delegatedFixMaxFiles) return { ok: false, reason: `${fix.files.length} arquivos (limite ${AGENT_PROFILE_RULES.delegatedFixMaxFiles})` };
  const sensitive = fix.files.find((f) => NIGHT_RULES.sensitivePaths.some((r) => r.test(f)));
  if (sensitive) return { ok: false, reason: `caminho sensível: ${sensitive}` };
  return { ok: true };
}
