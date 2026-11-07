// Resumo da ausência (etapa 13, F5b). Regras puras: recebem `now`, sem relógio, rede nem modelo.
// O agente nunca aceita, recusa ou marca nada em nome da pessoa: o resumo só conta o que chegou.
import { isAway } from "./rules.ts";
import { DAY, HOUR, localDate, weekdayOf, zonedTime } from "./time.ts";
import type { Absence, Person } from "./types.ts";

export const AWAY_DIGEST_RULES = {
  /** Pelo menos isto entre dois envios. */
  minGapHours: 3,
  /** Janela depois do início (ou do fim) do expediente em que o envio ainda sai (worker parado, reinício). */
  windowHours: 2,
  maxPerSection: 20,
  /** As linhas do resumo são apagadas na entrega ou depois disto. */
  retentionDays: 30,
  /** Uma linha de pedido e uma de resposta, cada uma com até isto de caracteres. */
  lineChars: 140,
} as const;

export type DigestKind = "reuniao" | "proposta" | "decisao" | "nenhum";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const KIND_RULES: readonly [Exclude<DigestKind, "nenhum">, RegExp][] = [
  ["decisao", /\b(decid(i|imos|iu|ido|ida)|decisao|ficou (definido|decidido|combinado)|esta (definido|decidido)|batemos o martelo|vamos seguir com|fechamos (que|com))\b/],
  ["reuniao", /\b(reuniao|reunioes|call|chamada|alinhamento|1:1|daily|agendar|marcar (uma|um|a|o)|bater um papo|conversar (amanha|hoje|na|no|as))\b/],
  ["proposta", /\b(propo(nho|mos|sta|stas|r)|sugir(o|imos)|sugestao|que tal|podemos|poderiamos|vamos (fazer|trocar|mudar|usar|adiar|antecipar)|topa|bora)\b/],
];

/** Tipo da mensagem para o resumo, por regra. A ordem decide: decisão, reunião, proposta. */
export function digestKind(text: string): DigestKind {
  const t = fold(text);
  for (const [kind, re] of KIND_RULES) if (re.test(t)) return kind;
  return "nenhum";
}

/** Uma linha só, sem menções nem formatação, cortada no limite. */
export function digestLine(text: string, max: number = AWAY_DIGEST_RULES.lineChars): string {
  const one = text
    .replace(/<@[^>]+>/g, "")
    .replace(/<![^>]*>/g, "") // <!here>, <!channel>, <!subteam^…>: não reavisa ninguém
    .replace(/<#[^|>]+\|([^>]*)>/g, "#$1")
    .replace(/<[^|>]+\|([^>]*)>/g, "$1") // <url|texto> → texto
    .replace(/<([^>]*)>/g, "$1")
    .replace(/[*_~`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

// ---------- Agenda

export type DigestSlot = "inicio" | "fim";

export interface AwayDigestDue {
  /** Data local da pessoa: com a pessoa e o momento, é a chave única do envio. */
  date: string;
  slot: DigestSlot;
}

/**
 * Início ou fim do expediente de hoje, no fuso da pessoa, há menos de 2 horas, e pelo menos 3 horas desde o
 * último envio. Em férias ou licença não sai nada: o resumo espera a volta. Pessoa inativa ou do RH: nada.
 */
export function awayDigestDue(person: Person, absences: Absence[], now: Date, lastSentAt?: Date | null): AwayDigestDue | null {
  if (!person.active || person.role === "hr") return null;
  if (isAway(person, absences, now).reason === "absence") return null;
  if (lastSentAt && now.getTime() - lastSentAt.getTime() < AWAY_DIGEST_RULES.minGapHours * HOUR) return null;
  const tz = person.timezone;
  for (const date of [localDate(now, tz), localDate(new Date(now.getTime() - DAY), tz)]) {
    if (!person.workHours.days.includes(weekdayOf(date))) continue;
    for (const slot of ["fim", "inicio"] as const) {
      const at = zonedTime(date, slot === "inicio" ? person.workHours.start : person.workHours.end, tz);
      const since = now.getTime() - at.getTime();
      if (since >= 0 && since < AWAY_DIGEST_RULES.windowHours * HOUR) return { date, slot };
    }
  }
  return null;
}

// ---------- Agrupamento

export interface DigestItem {
  id: string;
  askerId?: string | undefined;
  kind: DigestKind | null;
  /** answered | failed | silent | pending | processing */
  state: string;
  needsOwner: boolean;
  request?: string | undefined;
  reply?: string | undefined;
  createdAt: Date;
}

export type DigestSectionKey = "propostas" | "decisoes" | "sem_resposta" | "respondidas";

export interface DigestSection {
  key: DigestSectionKey;
  title: string;
  /** Até 20, do mais antigo ao mais novo. */
  items: DigestItem[];
  total: number;
}

const SECTION_TITLES: Record<DigestSectionKey, string> = { propostas: "Propostas", decisoes: "Decisões", sem_resposta: "Sem resposta", respondidas: "Respondidas" };

/** Seção de cada item: propostas e reuniões; decisões; sem resposta (falha ou o agente não soube); respondidas. */
export function digestSection(item: Pick<DigestItem, "kind" | "state" | "needsOwner">): DigestSectionKey {
  if (item.kind === "reuniao" || item.kind === "proposta") return "propostas";
  if (item.kind === "decisao") return "decisoes";
  if (item.state !== "answered" || item.needsOwner) return "sem_resposta";
  return "respondidas";
}

/** Agrupa nas quatro seções, sempre na mesma ordem. Sem item, o resumo não sai. */
export function awayDigest(items: readonly DigestItem[]): { sections: DigestSection[]; total: number } {
  const ordered = [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  const sections = (Object.keys(SECTION_TITLES) as DigestSectionKey[]).map((key) => {
    const all = ordered.filter((i) => digestSection(i) === key);
    return { key, title: SECTION_TITLES[key], items: all.slice(0, AWAY_DIGEST_RULES.maxPerSection), total: all.length };
  });
  return { sections, total: ordered.length };
}

/** Linhas criadas antes disto são apagadas, entregues ou não. */
export function digestPurgeBefore(now: Date): Date {
  return new Date(now.getTime() - AWAY_DIGEST_RULES.retentionDays * DAY);
}
