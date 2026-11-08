// Validador em código da resposta do modelo (etapa 6). Qualquer issue recusa a resposta.
// Checa: fontes desta execução, liberação real e do mesmo alvo, assuntos proibidos, primeira pessoa
// como o trabalhador, números que não vieram das regras e o idioma pedido.
//
// As frases são lidas por oração: negação ("não pode seguir") vale dentro da oração; condição e dúvida
// ("se Fernando liberar", "vale confirmar se") valem para a frase inteira.
//
// Cada idioma tem o próprio conjunto de padrões (português, inglês e espanhol), escolhido pelo idioma da
// conversa. Nunca se misturam: o "no" do espanhol é negação, e em português é "em + o".
import type { AnswerOutput, AnswerValidator, ValidationIssue, ValidatorContext } from "./index.ts";
import { DEFAULT_LANG, detectLanguage, type Lang } from "./language.ts";

// `\b` não enxerga letra acentuada: os limites de palavra usam `(?<!\p{L})` e `(?!\p{L})`.
const W0 = "(?<![\\p{L}\\d])";
const W1 = "(?![\\p{L}\\d])";
const re = (body: string, flags = "iu") => new RegExp(`${W0}(?:${body})${W1}`, flags);
/** Começo de nome próprio que não é o agente ("Sou o Fernando" acusa; "sou o agente de…" não). */
const notAgent = (words: string) => `(?!${words.split("|").map((w) => `${w}${W1}`).join("|")})\\p{Lu}`;

interface Patterns {
  negation: RegExp;
  condition: RegExp;
  expired: RegExp;
  release: RegExp;
  firstPerson: RegExp[];
  forbidden: RegExp;
  quantity: RegExp;
  clauseSplit: RegExp;
  /** "Sou o <dono>", "I am <dono>"… */
  asOwner: (owner: string) => RegExp;
}

const QUANTITY_HEAD = "(?<![\\p{L}\\d#/.-])(\\d+(?:[.,]\\d+)?)\\s*";

const PT: Patterns = {
  negation: re("n[ãa]o|nem|nunca|jamais|sem"),
  condition: re("se|caso|quando|confirmar|verificar|perguntar|talvez"),
  expired: re("expirou|expirad[ao]s?|venceu|vencid[ao]s?|estava liberad[ao]|esteve liberad[ao]"),
  release: re(
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
  ),
  firstPerson: [
    re("eu\\s+(?:n[ãa]o\\s+|j[áa]\\s+|ainda\\s+)?(?:deixei|fiz|volto|voltarei|vou|aprovo|aprovei|reservei|liberei|terminei|estou|estarei|trabalho|trabalhei|mexi|subi|abri|revisei|entreguei|prefiro|decidi|reviso)"),
    re("deixei|reservei|liberei|terminei|voltarei|entreguei|revisei|commitei|decidi|estarei de volta"),
    re("volto\\s+(?:amanh[ãa]|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|[àa]s|em|depois|logo|na|no)"),
    re("(?:meu|minha|meus|minhas)\\s+(?:revis[ãa]o|revis[õo]es|branch|branches|tarefas?|prs?|pull requests?|c[óo]digo|commits?|f[ée]rias|expediente|nota|trabalho|entregas?|prazos?|aus[êe]ncia)"),
    new RegExp(`${W0}[Ss]ou\\s+(?:o\\s+|a\\s+)?${notAgent("agente|[Ee]cho")}`, "u"),
    new RegExp(`${W0}[Aa]qui\\s+[ée]\\s+(?:o\\s+|a\\s+)?${notAgent("agente|[Ee]cho")}`, "u"),
  ],
  forbidden: re(
    [
      "(?:bom|boa|[óo]tim[oa]|excelente|ruim|frac[oa]|p[ée]ssim[oa]|melhor|pior)\\s+(?:funcion[áa]ri[oa]|profissional|colega|desenvolvedor[a]?|pessoa|trabalhador[a]?)",
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
  ),
  quantity: new RegExp(`${QUANTITY_HEAD}(?:%|por\\s*cento|commits?|pontos?|tarefas?|prs?|pull\\s+requests?|ajudas?|revis(?:[ãa]o|[õo]es)|entregas?|horas?|vezes|linhas|bugs?)${W1}`, "giu"),
  clauseSplit: /[,;:]|\s(?:mas|por[ée]m|contudo|entretanto|todavia)\s/iu,
  asOwner: (o) => new RegExp(`${W0}(?:sou|aqui\\s+[ée]|quem\\s+fala\\s+[ée])\\s+(?:o\\s+|a\\s+)?${escape(o)}${W1}`, "iu"),
};

const EN: Patterns = {
  negation: re("not|no|never|nor|without|cannot|can['’]t|isn['’]t|aren['’]t|doesn['’]t|don['’]t|didn['’]t|won['’]t|shouldn['’]t|hasn['’]t|haven['’]t|wasn['’]t|weren['’]t"),
  condition: re("if|unless|whether|when|once|confirm|check|ask|maybe|perhaps"),
  expired: re("expired|lapsed|was released|were released|used to be released|no longer"),
  release: re(
    [
      "(?:can|may)\\s+(?:go ahead|touch|work on|use|take over|take|continue|pick up|proceed|edit|merge|move forward|start)",
      "(?:is|are|was|were|has been|have been|got)\\s+released",
      "(?:is|are)\\s+(?:free|cleared)\\s+(?:to|for)",
      "(?:remains|stays|is still)\\s+released",
      "left\\s+(?:\\S+\\s+){0,4}?(?:released|free|open)\\s+for",
      "released\\s+(?:it|to|for)",
      "freed\\s+up",
    ].join("|"),
  ),
  firstPerson: [
    re("I\\s+(?:have\\s+|already\\s+|just\\s+|will\\s+|am\\s+)?(?:left|did|made|approve|approved|reserved|released|finished|worked|touched|pushed|opened|reviewed|delivered|decided|committed|merged)"),
    re("I(?:['’]ll|\\s+will)\\s+be\\s+back|I['’]m\\s+back|I\\s+return|I(?:['’]ll|\\s+will)\\s+(?:review|finish|deliver|approve|merge|work)"),
    re("my\\s+(?:review|reviews|branch|branches|tasks?|prs?|pull requests?|code|commits?|vacation|leave|shift|note|work|deliver(?:y|ies|ables)|deadlines?|absence)"),
    new RegExp(`${W0}I(?:\\s+am|['’]m)\\s+${notAgent("the|an|[Ee]cho|[Aa]gent")}`, "u"),
    new RegExp(`${W0}[Tt]his\\s+is\\s+${notAgent("the|an|a|[Ee]cho|[Aa]gent")}`, "u"),
  ],
  forbidden: re(
    [
      "(?:good|great|excellent|bad|weak|terrible|best|worst|better|worse)\\s+(?:employee|professional|colleague|developer|person|worker|engineer)",
      "(?:best|worst)\\s+(?:on|in|of)\\s+the\\s+team",
      "(?:delivers|works|produces|performs)\\s+(?:more|less|better|worse)\\s+than",
      "deserves?\\s+(?:a\\s+)?(?:promotion|raise|bonus|to\\s+be\\s+fired)",
      "promotion|promoted|fired|firing|layoffs?|salary|pay\\s+raise|ranking",
      "performance\\s+(?:review|rating|score)|time\\s+online|online\\s+time",
      "I\\s+(?:approve|approved|merged|deployed|published)|I(?:['’]ll|\\s+will)\\s+(?:approve|merge|deploy|publish)",
      "I\\s+(?:re)?assigned|I\\s+(?:transferred|handed\\s+over)|I\\s+changed\\s+the\\s+(?:owner|assignee)",
    ].join("|"),
  ),
  quantity: new RegExp(`${QUANTITY_HEAD}(?:%|percent|commits?|points?|tasks?|prs?|pull\\s+requests?|helps?|reviews?|deliver(?:y|ies)|hours?|times|lines|bugs?)${W1}`, "giu"),
  clauseSplit: /[,;:]|\s(?:but|however|although|though)\s/iu,
  asOwner: (o) => new RegExp(`${W0}(?:I\\s+am|I['’]m|this\\s+is|speaking\\s+is)\\s+${escape(o)}${W1}`, "iu"),
};

const ES: Patterns = {
  negation: re("no|ni|nunca|jam[áa]s|sin|tampoco"),
  condition: re("si|cuando|confirmar|verificar|preguntar|quiz[áa]s?|tal vez|en caso"),
  expired: re("expir[óo]|expirad[ao]s?|venci[óo]|vencid[ao]s?|estaba liberad[ao]|estuvo liberad[ao]"),
  release: re(
    [
      "puede(?:n)?\\s+(?:tocar|seguir|usar|asumir|continuar|tomar|trabajar|avanzar|editar|mergear|hacer\\s+merge|empezar)",
      "est[áa](?:n)?\\s+liberad[ao]s?",
      "fue(?:ron)?\\s+liberad[ao]s?",
      "(?:queda|qued[óo]|sigue|contin[úu]a)\\s+liberad[ao]",
      "dej[óo]\\s+(?:\\S+\\s+){0,4}?liberad[ao]",
      "liber[óo]",
      "liberad[ao]\\s+para",
      "est[áa]\\s+libre\\s+para",
    ].join("|"),
  ),
  firstPerson: [
    re("yo\\s+(?:no\\s+|ya\\s+|todav[íi]a\\s+)?(?:dej[ée]|hice|vuelvo|volver[ée]|voy|apruebo|aprob[ée]|reserv[ée]|liber[ée]|termin[ée]|estoy|estar[ée]|trabajo|trabaj[ée]|toqu[ée]|sub[íi]|abr[íi]|revis[ée]|entregu[ée]|prefiero|decid[íi]|reviso)"),
    re("dej[ée]|reserv[ée]|liber[ée]|termin[ée]|volver[ée]|entregu[ée]|revis[ée]|decid[íi]|estar[ée] de vuelta"),
    re("vuelvo\\s+(?:ma[ñn]ana|el|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo|a\\s+las|en|despu[ée]s|pronto)"),
    re("(?:mi|mis)\\s+(?:revisi[óo]n|revisiones|rama|ramas|branch|branches|tareas?|prs?|pull requests?|c[óo]digo|commits?|vacaciones|turno|nota|trabajo|entregas?|plazos?|ausencia)"),
    new RegExp(`${W0}[Ss]oy\\s+(?:el\\s+|la\\s+)?${notAgent("agente|[Ee]cho")}`, "u"),
    new RegExp(`${W0}[Aa]qu[íi]\\s+(?:habla|es)\\s+(?:el\\s+|la\\s+)?${notAgent("agente|[Ee]cho")}`, "u"),
  ],
  forbidden: re(
    [
      "(?:buen|buena|bueno|excelente|mal|mala|malo|p[ée]sim[oa]|mejor|peor)\\s+(?:emplead[oa]|profesional|colega|desarrollador[a]?|persona|trabajador[a]?)",
      "(?:mejor|peor)\\s+del\\s+equipo",
      "(?:entrega|trabaja|produce|rinde)n?\\s+(?:m[áa]s|menos)\\s+que",
      "merecen?\\s+(?:un\\s+|una\\s+)?(?:ascenso|aumento|despido|bono)",
      "ascenso|ascendid[oa]|despido|despedid[oa]|despedir|salario|sueldo|ranking",
      "evaluaci[óo]n\\s+de\\s+desempe[ñn]o|nota\\s+de\\s+desempe[ñn]o|tiempo\\s+en\\s+l[íi]nea",
      "apruebo|aprob[ée]|voy\\s+a\\s+aprobar|hice\\s+el\\s+merge|publiqu[ée]|voy\\s+a\\s+publicar",
      "(?:re)?asign[ée]|transfer[íi]|cambi[ée]\\s+(?:el|la)\\s+responsable|ya\\s+(?:pas[ée]|traspas[ée])",
    ].join("|"),
  ),
  quantity: new RegExp(`${QUANTITY_HEAD}(?:%|por\\s*ciento|commits?|puntos?|tareas?|prs?|pull\\s+requests?|ayudas?|revisi(?:[óo]n|ones)|entregas?|horas?|veces|l[íi]neas|bugs?)${W1}`, "giu"),
  clauseSplit: /[,;:]|\s(?:pero|sin\s+embargo|aunque)\s/iu,
  asOwner: (o) => new RegExp(`${W0}(?:soy|aqu[íi]\\s+(?:habla|es)|habla)\\s+(?:el\\s+|la\\s+)?${escape(o)}${W1}`, "iu"),
};

const PATTERNS: Record<Lang, Patterns> = { pt: PT, en: EN, es: ES };

/** Branch (ech-131-api-v2), tarefa (ECH-131) ou PR (app#42). */
const IDENTIFIER = /(?<![\p{L}\d-])([a-z][a-z0-9]*-\d+(?:-[a-z0-9]+)*|[\w.-]+#\d+)(?![\p{L}\d-])/giu;

const sentencesOf = (text: string) => text.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
const lower = (s: string) => s.toLocaleLowerCase("pt-BR");
const normNumber = (s: string) => s.replace(",", ".").replace(/\.0+$/, "");

/** Frases que afirmam uma liberação (sem negação, condição, dúvida ou liberação vencida). */
export function releaseClaims(text: string, lang: Lang = DEFAULT_LANG): { sentence: string; identifiers: string[] }[] {
  const p = PATTERNS[lang];
  const clausesOf = (sentence: string) => sentence.split(p.clauseSplit).map((s) => s.trim()).filter(Boolean);
  const claims: { sentence: string; identifiers: string[] }[] = [];
  for (const sentence of sentencesOf(text)) {
    if (p.expired.test(sentence)) continue;
    let offset = 0;
    for (const clause of clausesOf(sentence)) {
      const at = sentence.indexOf(clause, offset);
      offset = at >= 0 ? at + clause.length : offset;
      const m = p.release.exec(clause);
      if (!m) continue;
      if (p.negation.test(clause.slice(0, m.index))) continue;
      const before = sentence.slice(0, Math.max(at, 0) + m.index);
      if (p.condition.test(before)) continue;
      claims.push({ sentence, identifiers: [...sentence.matchAll(IDENTIFIER)].map((x) => lower(x[1]!)) });
      break;
    }
  }
  return claims;
}

export const validateAnswer: AnswerValidator = (out: AnswerOutput, ctx: ValidatorContext): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const text = out.texto;
  const lang = ctx.language ?? DEFAULT_LANG;
  const p = PATTERNS[lang];
  const clausesOf = (sentence: string) => sentence.split(p.clauseSplit).map((s) => s.trim()).filter(Boolean);

  // Idioma: a resposta sai no idioma da conversa. Outro idioma escaparia dos padrões abaixo.
  const written = detectLanguage(text, lang);
  if (written.confident && written.lang !== lang) issues.push({ code: "idioma_errado", detail: `pedido em ${lang}, escrito em ${written.lang}` });

  // Fontes: só as consultadas nesta execução; afirmação precisa de ao menos uma.
  const known = new Set(ctx.sourcesThisRun);
  for (const f of out.fontes) if (!known.has(f)) issues.push({ code: "fonte_inexistente", detail: `fonte não consultada nesta execução: ${f}` });
  if (out.status === "respondido" && out.fontes.length === 0) issues.push({ code: "fonte_inexistente", detail: "resposta afirmativa sem nenhuma fonte" });

  // Liberação: o alvo precisa estar entre as liberações reais desta execução, e o texto não pode afirmar outra.
  const released = new Set(ctx.releasedTargets.map(lower));
  if (out.liberacao && !released.has(lower(out.liberacao.alvo))) {
    issues.push({ code: "liberacao_falsa", detail: `sem liberação registrada para ${out.liberacao.alvo}` });
  }
  for (const claim of releaseClaims(text, lang)) {
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
  if (p.firstPerson.some((r) => r.test(text)) || (owner && p.asOwner(owner).test(text))) {
    issues.push({ code: "primeira_pessoa", detail: "falou na primeira pessoa como o trabalhador" });
  }

  // Assuntos proibidos, fora de orações negadas ("não avalio pessoas").
  for (const sentence of sentencesOf(text)) {
    const hit = clausesOf(sentence).find((clause) => {
      const m = p.forbidden.exec(clause);
      return m && !p.negation.test(clause.slice(0, m.index));
    });
    if (hit) {
      issues.push({ code: "assunto_proibido", detail: `assunto proibido: "${hit}"` });
      break;
    }
  }

  // Números: só os que vieram das regras nesta execução.
  const allowed = new Set((ctx.allowedNumbers ?? []).map(normNumber));
  for (const m of text.matchAll(p.quantity)) {
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
