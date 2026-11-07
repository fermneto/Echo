// Validador da resposta do agente (etapa 6). Roda em código, depois do modelo e antes de publicar.
// Recusa: fonte que não foi consultada, liberação que não existe, assunto proibido, primeira pessoa
// como o trabalhador e número que não veio das regras. Qualquer problema → resposta por regra.
import type { AnswerOutput, AnswerValidator, ValidationIssue } from "./contracts.ts";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const sentences = (t: string) => t.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const clauses = (s: string) => s.split(/,\s*(?:mas|porem|so que|entretanto)?\s*|\s+(?:mas|porem|entretanto)\s+|:\s+/).map((c) => c.trim()).filter(Boolean);

/** Afirma que algo pode ser usado agora. */
const RELEASE = /\b(pode (seguir|mexer|continuar|usar|assumir|trabalhar|pegar)|(esta|fica|ficou|segue) liberad[ao]|liberad[ao] para|deixou\b.*\bliberad[ao]|tem liberacao)\b/;
/** Oração negada ou que nega a liberação. */
const NEGATED = /\b(nao|nunca|nenhum|nenhuma|sem liberacao)\b/;
/** A frase inteira é condicional, dúvida ou fala de uma liberação que já não vale. */
const NOT_ASSERTIVE = /(^se\b|\bcaso\b|\bse (ele|ela|\w+) (liberar|deixar|confirmar)|\b(confirmar|verificar|perguntar|checar|saber)\b.*\bse\b|\bexpir|\bvencid|\bvenceu|\bestava liberad)/;
/** Identificadores de branch e de tarefa citados (ech-128-tempo-limite, ECH-131). */
const TARGETS = /\b[a-z]{2,10}-\d+(?:-[a-z0-9-]+)?\b/g;

function releaseIssues(out: AnswerOutput, released: string[]): ValidationIssue[] {
  const ok = new Set(released.map(norm));
  const issues: ValidationIssue[] = [];
  if (out.liberacao && !ok.has(norm(out.liberacao.alvo))) {
    issues.push({ code: "liberacao_falsa", detail: `liberação de "${out.liberacao.alvo}" sem registro nesta execução` });
  }
  for (const sentence of sentences(out.texto)) {
    const s = norm(sentence);
    if (NOT_ASSERTIVE.test(s)) continue;
    for (const clause of clauses(s)) {
      if (!RELEASE.test(clause) || NEGATED.test(clause)) continue;
      const cited = clause.match(TARGETS) ?? [];
      if (!out.liberacao) {
        issues.push({ code: "liberacao_falsa", detail: `o texto afirma liberação sem o campo liberacao: "${sentence}"` });
      } else if (cited.some((c) => !ok.has(c))) {
        issues.push({ code: "liberacao_falsa", detail: `o texto libera algo diferente do registrado: "${sentence}"` });
      }
    }
  }
  return issues;
}

function firstPersonIssues(texto: string, ownerName?: string): ValidationIssue[] {
  // O agente falando de si ("sou o agente de Fernando") é permitido.
  const t = norm(texto).replace(/\b(eu )?sou o agente( de \w+)?/g, "").replace(/\bo agente de \w+/g, "");
  const owner = ownerName ? norm(ownerName.split(" ")[0]!) : null;
  const pronoun = /\b(eu|meu|minha|meus|minhas|comigo)\b/.test(t);
  const impersonates = owner ? new RegExp(`\\b(sou|aqui e|quem fala e)\\s+(o|a)\\s+${owner}\\b`).test(t) : false;
  return pronoun || impersonates ? [{ code: "primeira_pessoa", detail: "a resposta fala como o trabalhador" }] : [];
}

const FORBIDDEN = /\b((otim|excelente|bom|boa|ruim|pessim|fraco|fraca)\w* (funcionari|profissional|colega|desenvolvedor|pessoa)|merece\b.*\b(promocao|aumento|demissao)|promover|promocao|demiss|demitir|salario|ranking|o melhor do time|o pior do time|entrega mais que|entrega menos que|mais produtiv|menos produtiv|melhor que|pior que)/;

function forbiddenIssues(texto: string): ValidationIssue[] {
  for (const sentence of sentences(texto)) {
    const s = norm(sentence);
    // "Não avalio pessoas nem comparo colegas" é recusa, não avaliação.
    if (NEGATED.test(s)) continue;
    if (FORBIDDEN.test(s)) return [{ code: "assunto_proibido", detail: `avaliação ou comparação de pessoas: "${sentence}"` }];
  }
  return [];
}

function numberIssues(texto: string): ValidationIssue[] {
  const stripped = texto
    .replace(/\b[a-z]{1,15}-\d+[\w-]*/gi, " ") // ECH-140, ech-131-api-v2
    .replace(/[\w.-]*#\d+/g, " ") // app#42, #42
    .replace(/\bPRs?\s*\d+\b/gi, " ") // PR 42
    .replace(/\b\d{1,2}h(\d{2})?\b/gi, " ") // 9h, 9h30 (a hora de volta vem do código)
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, " ");
  const m = stripped.match(/\d+([.,]\d+)?\s*%?/);
  return m ? [{ code: "numero_inventado", detail: `número fora das regras: "${m[0].trim()}"` }] : [];
}

function sourceIssues(out: AnswerOutput, consulted: string[]): ValidationIssue[] {
  const ok = new Set(consulted);
  const unknown = out.fontes.filter((f) => !ok.has(f));
  if (unknown.length) return [{ code: "fonte_inexistente", detail: `fontes não consultadas nesta execução: ${unknown.join(", ")}` }];
  // Afirmar algo exige fonte; "não sei" e recusa não.
  if (out.status === "respondido" && out.fontes.length === 0) return [{ code: "fonte_inexistente", detail: "resposta sem nenhuma fonte" }];
  return [];
}

export const validateAnswer: AnswerValidator = (out, ctx) => [
  ...sourceIssues(out, ctx.sourcesThisRun),
  ...releaseIssues(out, ctx.releasedTargets),
  ...firstPersonIssues(out.texto, ctx.ownerName),
  ...forbiddenIssues(out.texto),
  ...numberIssues(out.texto),
];
