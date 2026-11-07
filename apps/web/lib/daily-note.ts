import type { BranchMark, DailyNote, DailyNoteState } from "@echo/domain";

/**
 * Nota do dia no painel: quatro listas que a pessoa confere e confirma. Regras puras de conversão entre
 * a nota guardada (texto e marcas de branch) e as listas da tela, testadas em daily-note.test.ts.
 */

export const SECTION_KEYS = ["stoppedAt", "blocked", "released", "reserved"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export type NoteSections = Record<SectionKey, string[]>;

export const MAX_ITEMS = 8;
export const MAX_ITEM = 300;

export type NoteView = {
  /** AAAA-MM-DD no fuso da pessoa. */
  date: string;
  state: DailyNoteState;
  sections: NoteSections;
  /** A nota é de outro dia (sem atividade hoje, vale a anterior). */
  previous?: boolean;
};

export const STATE_LABEL: Record<DailyNoteState, { label: string; tone: "wait" | "on" | "twin" }> = {
  draft: { label: "Rascunho", tone: "wait" },
  confirmed: { label: "Confirmada", tone: "on" },
  auto_unreviewed: { label: "Enviada sem revisão", tone: "twin" },
};

export const emptySections = (): NoteSections => ({ stoppedAt: [], blocked: [], released: [], reserved: [] });

/** Itens limpos: sem vazios, com tamanho e quantidade limitados. */
export function cleanItems(raw: readonly unknown[]): string[] {
  return raw
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
}

export function sectionsFromForm(form: FormData): NoteSections {
  const out = emptySections();
  for (const k of SECTION_KEYS) out[k] = cleanItems(form.getAll(k));
  return out;
}

const noDot = (s: string) => s.trim().replace(/\.$/, "").trim();

/** "Onde parou" é texto livre: uma linha por item. */
export const splitStopped = (text: string | undefined): string[] => cleanItems((text ?? "").split("\n"));
export const joinStopped = (items: readonly string[]): string => items.join("\n");

/** Bloqueios seguem o texto da regra ("PR 44 aguarda revisão; ECH-9 passou do prazo."). */
export const splitBlocked = (text: string | undefined): string[] => cleanItems((text ?? "").split(/\n|;\s+/).map(noDot));
export function joinBlocked(items: readonly string[]): string {
  const parts = items.map(noDot).filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : "";
}

export type NamedPerson = { id: string; name: string };
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Marca de branch numa linha: "ech-131-api-v2 para Eduardo: formato fechado". */
export function markLine(m: BranchMark, people: readonly NamedPerson[], kind: "released" | "reserved"): string {
  const who = kind === "released" && m.to ? people.find((p) => p.id === m.to) : undefined;
  return `${m.branch}${who ? ` para ${first(who.name)}` : ""}${m.reason ? `: ${noDot(m.reason)}` : ""}`;
}

/**
 * Linha de volta a marca. A primeira palavra é o branch; "para Nome" só vale em liberado e só com pessoa da empresa;
 * o prazo (`until`) de uma marca já guardada com o mesmo branch é mantido.
 */
export function parseMark(line: string, people: readonly NamedPerson[], stored: readonly BranchMark[], kind: "released" | "reserved"): BranchMark | null {
  const head = /^`?([^\s`:]+)`?(.*)$/.exec(line.trim());
  if (!head?.[1]) return null;
  const branch = head[1];
  const rest = head[2] ?? "";
  let name: string | undefined;
  let reason: string;
  const para = /^\s+para\s+([^:]+?)\s*(?::\s*(.*))?$/i.exec(rest);
  if (para) {
    name = para[1]!.trim();
    reason = para[2] ?? "";
  } else reason = rest.replace(/^\s*:?\s*/, "");
  const lower = name?.toLowerCase();
  const to = kind === "released" && lower ? people.find((p) => first(p.name).toLowerCase() === lower || p.name.toLowerCase() === lower)?.id : undefined;
  // Nome que não é de ninguém da empresa (ou "para" em reservado) fica no motivo, sem virar destinatário.
  const reasonText = [name && !to ? `para ${name}` : "", noDot(reason)].filter(Boolean).join(": ");
  const until = stored.find((s) => s.branch === branch)?.until;
  return { branch, ...(to ? { to } : {}), ...(reasonText ? { reason: reasonText } : {}), ...(until ? { until } : {}) };
}

export function sectionsFromNote(note: Pick<DailyNote, "stoppedAt" | "blocked" | "released" | "reserved">, people: readonly NamedPerson[]): NoteSections {
  return {
    stoppedAt: splitStopped(note.stoppedAt),
    blocked: splitBlocked(note.blocked),
    released: note.released.map((m) => markLine(m, people, "released")),
    reserved: note.reserved.map((m) => markLine(m, people, "reserved")),
  };
}

/** Edições da tela no formato que o fluxo de confirmação aceita (`NotePatch`). */
export function patchFromSections(
  s: NoteSections,
  people: readonly NamedPerson[],
  stored: Pick<DailyNote, "released" | "reserved">,
): { stoppedAt: string; blocked: string; released: BranchMark[]; reserved: BranchMark[] } {
  const marks = (kind: "released" | "reserved") => s[kind].map((l) => parseMark(l, people, stored[kind], kind)).filter((m): m is BranchMark => m !== null);
  return { stoppedAt: joinStopped(s.stoppedAt), blocked: joinBlocked(s.blocked), released: marks("released"), reserved: marks("reserved") };
}

/** "07/11" a partir de AAAA-MM-DD. */
export const dayMonth = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

// ---------- Demonstração (sem banco): rascunho do perfil e confirmação no cookie do visitante

export const DAILY_NOTE_COOKIE = "echo_nota_dia";

export type DemoNoteEntry = { date: string; sections: NoteSections; confirmed: boolean };
export type DemoNotes = Record<string, DemoNoteEntry>;

/** Rascunho da demo: a última nota do perfil ou, sem ela, o foco e o trabalho em andamento. */
export function demoDraft(profile: { focus?: string; work: { title: string }[]; lastNote?: { stoppedAt: string; blocked: string[]; released: string[]; reserved: string[] } }): NoteSections {
  if (profile.lastNote) {
    const n = profile.lastNote;
    return { stoppedAt: cleanItems([n.stoppedAt]), blocked: cleanItems(n.blocked), released: cleanItems(n.released), reserved: cleanItems(n.reserved) };
  }
  const stopped = profile.focus ? [profile.focus] : profile.work.slice(0, 1).map((w) => w.title);
  return { ...emptySections(), stoppedAt: cleanItems(stopped) };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDemoNotes(raw: string | undefined): DemoNotes {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: DemoNotes = {};
    for (const [id, e] of Object.entries(data as Record<string, unknown>).slice(0, 20)) {
      const entry = e as Partial<DemoNoteEntry> | null;
      if (!entry || typeof entry.date !== "string" || !ISO_DAY.test(entry.date) || !entry.sections || typeof entry.sections !== "object") continue;
      const sections = emptySections();
      for (const k of SECTION_KEYS) {
        const list = (entry.sections as Partial<NoteSections>)[k];
        sections[k] = Array.isArray(list) ? cleanItems(list) : [];
      }
      out[id] = { date: entry.date, sections, confirmed: entry.confirmed === true };
    }
    return out;
  } catch {
    return {};
  }
}

/** A nota de hoje na demo: a do cookie se for de hoje, senão o rascunho do agente. */
export function demoNoteView(saved: DemoNoteEntry | undefined, today: string, draft: NoteSections): NoteView {
  if (saved && saved.date === today) return { date: today, state: saved.confirmed ? "confirmed" : "draft", sections: saved.sections };
  return { date: today, state: "draft", sections: draft };
}
