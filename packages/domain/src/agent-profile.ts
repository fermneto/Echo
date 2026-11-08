// Personalização do agente pela própria pessoa (texto livre): como ele responde e até onde decide por ela.
// O texto muda o tom e, na delegação, só pode liberar o que as travas abaixo permitem. Nada aqui chama modelo.
import { NIGHT_RULES } from "./night.ts";

export const AGENT_PROFILE_RULES = {
  /** Limite de cada texto (estilo e delegação). Cabe no prompt sem pesar no custo. */
  maxChars: 1200,
  /** Correção que o agente pode aplicar sozinho pela delegação: pequena, testada e fora de caminho sensível. */
  delegatedFixMaxFiles: 5,
  /** Quanto a delegação espera o CI do rascunho terminar; passou disso, a correção fica com a pessoa. */
  delegatedCiWaitMinutes: 45,
  /** Sem nenhum check no rascunho por este tempo (repositório sem CI): fica com a pessoa. */
  delegatedCiNoChecksMinutes: 15,
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

/**
 * CI do commit do rascunho que seria unido, lido no GitHub. `none`: nenhum check ainda (logo depois de abrir o
 * rascunho) ou o repositório não tem CI; `unknown`: não deu para ler.
 */
export type DraftCiState = "success" | "failure" | "pending" | "neutral" | "none" | "unknown";

export type DelegatedCiGate = { ok: true } | { ok: false; reason: string } | { wait: true; reason: string };

/**
 * O "testes passaram" do fix.json é o próprio agente da correção quem diz: a delegação só une com o CI do
 * rascunho verde, no commit exato que vai ser unido. Falhou ou só teve checks neutros: fica com a pessoa.
 * Rodando, sem checks ou sem leitura: espera (o sync confere de novo) até o prazo; depois, fica com a pessoa.
 */
export function delegatedCiGate(ci: DraftCiState, waitingSince: Date, now: Date): DelegatedCiGate {
  if (ci === "success") return { ok: true };
  if (ci === "failure") return { ok: false, reason: "o CI do rascunho falhou" };
  if (ci === "neutral") return { ok: false, reason: "o CI do rascunho não deu resultado (só checks neutros ou pulados)" };
  const waited = (now.getTime() - waitingSince.getTime()) / 60_000;
  const limit = ci === "none" ? AGENT_PROFILE_RULES.delegatedCiNoChecksMinutes : AGENT_PROFILE_RULES.delegatedCiWaitMinutes;
  const label = ci === "pending" ? "o CI do rascunho ainda está rodando" : ci === "none" ? "o rascunho ainda não tem CI" : "não deu para ler o CI do rascunho";
  if (waited < limit) return { wait: true, reason: label };
  return { ok: false, reason: ci === "pending" ? `o CI do rascunho não terminou em ${limit} min` : ci === "none" ? `o rascunho não teve CI em ${limit} min` : `não deu para ler o CI do rascunho em ${limit} min` };
}
