// Validador em código da resposta do modelo (etapa 6). Qualquer issue recusa a resposta.
// Checa: fontes desta execução, liberação real e do mesmo alvo, assuntos proibidos, primeira pessoa
// como o trabalhador e números que não vieram das regras.
//
// As frases são lidas por oração: negação ("não pode seguir") vale dentro da oração; condição e dúvida
// ("se Fernando liberar", "vale confirmar se") valem para a frase inteira.
import type { AnswerOutput, AnswerValidator, ValidationIssue, ValidatorContext } from "./index.ts";

// `\b` não enxerga letra acentuada: os limites de palavra usam `(?<!\p{L})` e `(?!\p{L})`.
const W0 = "(?<![\\p{L}\\d])";
const W1 = "(?![\\p{L}\\d])";
const re = (body: string, flags = "iu") => new RegExp(`${W0}(?:${body})${W1}`, flags);

const NEGATION = re("n[ãa]o|nem|nunca|jamais|sem");
const CONDITION = re("se|caso|quando|confirmar|verificar|perguntar|talvez");
const EXPIRED = re("expirou|expirad[ao]s?|venceu|vencid[ao]s?|estava liberad[ao]|esteve liberad[ao]");

const RELEASE = re(
  [
    "pode(?:m)?\\s+(?:mexer|seguir|usar|assumir|continuar|pegar|trabalhar|avan[çc]ar|editar|mergear|ir em frente)",
    "est[áa](?:o)?\\s+liberad[ao]s?",
    "t[áa]\\s+liberad[ao]",
    "fo(?:i|ram)\\s+liberad[ao]s?",
    "(?:fica|ficou|segue|continua)\\s+liberad[ao]",
    "deixou\\s+(?:\\S+\\s+){0,4}?liberad[ao]",
    "liberou",
    "liberad[ao]\\s+para",
  ].join("|"),
);

/** Branch (ech-131-api-v2), tarefa (ECH-131) ou PR (app#42). */
const IDENTIFIER = /(?<![\p{L}\d-])([a-z][a-z0-9]*-\d+(?:-[a-z0-9]+)*|[\w.-]+#\d+)(?![\p{L}\d-])/giu;

const FIRST_PERSON: RegExp[] = [
  re("eu\\s+(?:n[ãa]o\\s+|j[áa]\\s+|ainda\\s+)?(?:deixei|fiz|volto|voltarei|vou|aprovo|aprovei|reservei|liberei|terminei|estou|estarei|trabalho|trabalhei|mexi|subi|abri|revisei|entreguei|prefiro|decidi|reviso)"),
  re("deixei|reservei|liberei|terminei|voltarei|entreguei|revisei|commitei|decidi|estarei de volta"),
  re("volto\\s+(?:amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|[àa]s|em|depois|logo|na|no)"),
  re("(?:meu|minha|meus|minhas)\\s+(?:revis[ãa]o|revis[õo]es|branch|branches|tarefas?|prs?|pull requests?|c[óo]digo|commits?|f[ée]rias|expediente|nota|trabalho|entregas?|prazos?|aus[êe]ncia)"),
  // "Sou o Fernando", "Aqui é a Carla" — o agente pode dizer "sou o agente de…".
  new RegExp(`${W0}[Ss]ou\\s+(?:o\\s+|a\\s+)?(?!agente${W1}|[Ee]cho${W1})\\p{Lu}`, "u"),
  new RegExp(`${W0}[Aa]qui\\s+[ée]\\s+(?:o\\s+|a\\s+)?(?!agente${W1}|[Ee]cho${W1})\\p{Lu}`, "u"),
];

const FORBIDDEN = re(
  [
    "(?:bom|boa|[óo]tim[oa]|excelente|[óo]tim[oa]|ruim|frac[oa]|p[ée]ssim[oa]|melhor|pior)\\s+(?:funcion[áa]ri[oa]|profissional|colega|desenvolvedor[a]?|pessoa|trabalhador[a]?)",
    "(?:melhor|pior)\\s+d[oa]\\s+(?:time|equipe)",
    "(?:entrega|trabalha|produz|rende)m?\\s+(?:mais|menos)\\s+(?:que|do que)",
    "merecem?\\s+(?:uma\\s+|um\\s+)?(?:promo[çc][ãa]o|aumento|demiss[ãa]o|b[ôo]nus)",
    "promo[çc][ãa]o|promovid[oa]|demiss[ãa]o|demitid[oa]|demitir|sal[áa]rio|aumento\\s+de\\s+sal[áa]rio|ranking",
    "nota\\s+de\\s+desempenho|avalia[çc][ãa]o\\s+de\\s+desempenho|tempo\\s+online",
    // O agente nunca aprova nem publica.
    "aprovo|aprovei|vou\\s+aprovar|fiz\\s+o\\s+merge|publiquei|vou\\s+publicar",
    // Nem muda tarefas: só sugere, e a troca passa por aprovação.
    "(?:re)?atribu[íi]|transferi|mudei\\s+(?:o|a)\\s+respons[áa]vel|j[áa]\\s+(?:passei|repassei)",
  ].join("|"),
);

/** Quantidade com unidade de métrica: o que o modelo não pode inventar. Identificadores (ECH-140, app#42) ficam de fora. */
const QUANTITY = new RegExp(
  `(?<![\\p{L}\\d#/.-])(\\d+(?:[.,]\\d+)?)\\s*(?:%|por\\s*cento|commits?|pontos?|tarefas?|prs?|pull\\s+requests?|ajudas?|revis(?:[ãa]o|[õo]es)|entregas?|horas?|vezes|linhas|bugs?)${W1}`,
  "giu",
);

const sentencesOf = (text: string) => text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
/** Orações: vírgula, dois-pontos, ponto e vírgula e conjunções adversativas. */
const clausesOf = (sentence: string) => sentence.split(/[,;:]|\s(?:mas|por[ée]m|contudo|entretanto|todavia)\s/iu).map((s) => s.trim()).filter(Boolean);
const lower = (s: string) => s.toLocaleLowerCase("pt-BR");
const normNumber = (s: string) => s.replace(",", ".").replace(/\.0+$/, "");

/** Frases que afirmam uma liberação (sem negação, condição, dúvida ou liberação vencida). */
export function releaseClaims(text: string): { sentence: string; identifiers: string[] }[] {
  const claims: { sentence: string; identifiers: string[] }[] = [];
  for (const sentence of sentencesOf(text)) {
    if (EXPIRED.test(sentence)) continue;
    let offset = 0;
    for (const clause of clausesOf(sentence)) {
      const at = sentence.indexOf(clause, offset);
      offset = at >= 0 ? at + clause.length : offset;
      const m = RELEASE.exec(clause);
      if (!m) continue;
      if (NEGATION.test(clause.slice(0, m.index))) continue;
      const before = sentence.slice(0, Math.max(at, 0) + m.index);
      if (CONDITION.test(before)) continue;
      claims.push({ sentence, identifiers: [...sentence.matchAll(IDENTIFIER)].map((x) => lower(x[1]!)) });
      break;
    }
  }
  return claims;
}

export const validateAnswer: AnswerValidator = (out: AnswerOutput, ctx: ValidatorContext): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const text = out.texto;

  // Fontes: só as consultadas nesta execução; afirmação precisa de ao menos uma.
  const known = new Set(ctx.sourcesThisRun);
  for (const f of out.fontes) if (!known.has(f)) issues.push({ code: "fonte_inexistente", detail: `fonte não consultada nesta execução: ${f}` });
  if (out.status === "respondido" && out.fontes.length === 0) issues.push({ code: "fonte_inexistente", detail: "resposta afirmativa sem nenhuma fonte" });

  // Liberação: o alvo precisa estar entre as liberações reais desta execução, e o texto não pode afirmar outra.
  const released = new Set(ctx.releasedTargets.map(lower));
  if (out.liberacao && !released.has(lower(out.liberacao.alvo))) {
    issues.push({ code: "liberacao_falsa", detail: `sem liberação registrada para ${out.liberacao.alvo}` });
  }
  for (const claim of releaseClaims(text)) {
    if (!out.liberacao) {
      issues.push({ code: "liberacao_falsa", detail: `o texto afirma liberação sem registro: "${claim.sentence}"` });
      break;
    }
    const wrong = claim.identifiers.find((id) => !released.has(id));
    if (wrong) {
      issues.push({ code: "liberacao_falsa", detail: `o texto libera ${wrong}, que não tem liberação registrada` });
      break;
    }
  }

  // Primeira pessoa como o trabalhador.
  const owner = ctx.ownerName?.trim();
  const asOwner = owner ? new RegExp(`${W0}(?:sou|aqui\\s+[ée]|quem\\s+fala\\s+[ée])\\s+(?:o\\s+|a\\s+)?${escape(owner)}${W1}`, "iu") : null;
  if (FIRST_PERSON.some((r) => r.test(text)) || asOwner?.test(text)) {
    issues.push({ code: "primeira_pessoa", detail: "falou na primeira pessoa como o trabalhador" });
  }

  // Assuntos proibidos, fora de orações negadas ("não avalio pessoas").
  for (const sentence of sentencesOf(text)) {
    const hit = clausesOf(sentence).find((clause) => {
      const m = FORBIDDEN.exec(clause);
      return m && !NEGATION.test(clause.slice(0, m.index));
    });
    if (hit) {
      issues.push({ code: "assunto_proibido", detail: `assunto proibido: "${hit}"` });
      break;
    }
  }

  // Números: só os que vieram das regras nesta execução.
  const allowed = new Set((ctx.allowedNumbers ?? []).map(normNumber));
  for (const m of text.matchAll(QUANTITY)) {
    if (!allowed.has(normNumber(m[1]!))) {
      issues.push({ code: "numero_inventado", detail: `número sem regra: "${m[0]}"` });
      break;
    }
  }

  return issues;
};

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
