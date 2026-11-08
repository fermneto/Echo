// Idioma da conversa: o agente responde no idioma em que falaram com ele. Escolhido por regra (palavras e
// sinais de cada idioma), não pelo modelo: o validador precisa saber em que idioma conferir a resposta.
// Idiomas com validador: português, inglês e espanhol. Outro idioma, ou texto sem sinal, fica no padrão.

export type Lang = "pt" | "en" | "es";
export const LANGS: readonly Lang[] = ["pt", "en", "es"];
export const DEFAULT_LANG: Lang = "pt";

// Só palavras que distinguem um idioma dos outros dois (sem "que", "de", "no", "para"…, comuns a pt e es).
const WORDS: Record<Lang, string[]> = {
  // "o", "os", "as", "e", "ao": artigos e conjunção do português ("o"/"y"/"el" no espanhol); "todo", "como", "esta" são dos dois.
  pt: ["não", "nao", "você", "voce", "está", "estão", "isso", "isto", "quem", "pode", "posso", "também", "tambem", "ainda", "já", "uma", "um", "com", "em", "do", "da", "dos", "das", "na", "nas", "ele", "ela", "eles", "meu", "minha", "seu", "sua", "seus", "suas", "tem", "têm", "são", "sao", "qual", "quais", "quando", "onde", "alguém", "alguem", "algo", "mexer", "deixou", "aberto", "abertos", "pendente", "atrasado", "hoje", "amanhã", "depois", "obrigado", "olá", "oi", "tudo", "sobre", "porque", "então", "mas", "mais", "muito", "agora", "volta", "férias", "ferias", "o", "os", "as", "e", "ao", "aos", "à", "às", "pelo", "pela", "nem", "foi", "vem", "ano", "semana", "time", "equipe", "trabalho", "terminou", "mostra", "deu", "fala", "preciso", "quero", "quantas", "quantos", "até"],
  en: ["the", "is", "are", "was", "can", "could", "i", "you", "who", "what", "when", "where", "how", "why", "it", "this", "that", "to", "of", "in", "on", "for", "with", "my", "does", "do", "did", "has", "have", "not", "be", "will", "there", "any", "anyone", "anything", "about", "open", "pending", "late", "today", "tomorrow", "back", "please", "thanks", "hi", "hello", "work", "touch", "left", "and", "or", "but", "now", "should", "would", "which"],
  es: ["el", "la", "los", "las", "es", "está", "están", "usted", "tú", "eso", "esto", "quién", "puede", "puedo", "también", "todavía", "ya", "un", "una", "con", "en", "del", "él", "ella", "ellos", "mi", "tiene", "tienen", "son", "cuál", "cuándo", "dónde", "cómo", "alguien", "algo", "tocar", "dejó", "abierto", "abiertos", "pendiente", "atrasado", "hoy", "mañana", "después", "gracias", "hola", "sobre", "porque", "entonces", "pero", "más", "mucho", "ahora", "vuelve", "vacaciones", "hay", "qué", "trabajar", "rama", "y", "al", "lo", "le", "les", "su", "sus", "hasta", "fue", "equipo", "trabajo", "terminó", "muestra", "necesito", "quiero", "cuántas", "cuántos", "semana"],
};
// Palavra que aparece em mais de um idioma não conta para nenhum.
const COUNTS = new Map<string, number>();
for (const l of LANGS) for (const w of new Set(WORDS[l])) COUNTS.set(w, (COUNTS.get(w) ?? 0) + 1);
const UNIQUE: Record<Lang, Set<string>> = {
  pt: new Set(WORDS.pt.filter((w) => COUNTS.get(w) === 1)),
  en: new Set(WORDS.en.filter((w) => COUNTS.get(w) === 1)),
  es: new Set(WORDS.es.filter((w) => COUNTS.get(w) === 1)),
};

/** Sinais de escrita: til e cedilha (pt), ñ e pontuação invertida (es). */
const MARKS: Record<Lang, RegExp> = { pt: /[ãõç]/giu, en: /(?!)/g, es: /[ñ¿¡]/giu };

export interface Detected {
  lang: Lang;
  /** Sinal claro (ao menos 2 pontos e o dobro do segundo): só assim o validador acusa idioma trocado. */
  confident: boolean;
}

/** Idioma de um texto. Identificadores (ech-131-api, app#42, ECH-140) e endereços não contam. */
export function detectLanguage(text: string, fallback: Lang = DEFAULT_LANG): Detected {
  const clean = text.replace(/https?:\/\/\S+/g, " ").replace(/[\w.-]*[#\d][\w.#-]*/g, " ");
  const words = clean.toLocaleLowerCase().match(/\p{L}+/gu) ?? [];
  const score: Record<Lang, number> = { pt: 0, en: 0, es: 0 };
  for (const w of words) for (const l of LANGS) if (UNIQUE[l].has(w)) score[l]++;
  for (const l of LANGS) score[l] += (clean.match(MARKS[l]) ?? []).length * 2;
  const [first, second] = [...LANGS].sort((a, b) => score[b] - score[a]);
  if (score[first!] === 0 || score[first!] === score[second!]) return { lang: fallback, confident: false };
  return { lang: first!, confident: score[first!] >= 2 && score[first!] >= 2 * score[second!] };
}

/** Nome do agente no idioma da conversa (regra 5: sempre se identifica como agente da pessoa). */
export function agentLabel(ownerName: string | undefined, lang: Lang): string {
  if (!ownerName) return "Echo";
  return lang === "en" ? `${ownerName}'s agent` : `Agente de ${ownerName}`;
}

/** Locale para datas e horas. */
export const LOCALE: Record<Lang, string> = { pt: "pt-BR", en: "en-US", es: "es-ES" };
