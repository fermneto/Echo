import type { NoteVersion } from "./demo/notes";

/**
 * Notas do cérebro (packages/brain) no formato das telas. Regras de exibição puras: o que cada pessoa vê já vem
 * filtrado pela busca do cérebro (canSee), e o RH nunca chega aqui.
 */

export const MAX_BRAIN_NOTE = 4000;

/** "# Título\n\ntexto" → título e texto. Sem título, vale o nome do arquivo. */
export function splitNote(content: string, path: string): { title: string; body: string; hasHeading: boolean } {
  const m = /^#\s+(.+)\r?\n?([\s\S]*)$/.exec(content.trimStart());
  if (m) return { title: m[1]!.trim(), body: m[2]!.trim(), hasHeading: true };
  const file = path.split("/").pop() ?? path;
  const name = file.replace(/\.md$/, "").replace(/[-_]+/g, " ");
  return { title: name.charAt(0).toUpperCase() + name.slice(1), body: content.trim(), hasHeading: false };
}

/** Texto corrigido de volta ao formato do arquivo, mantendo o título. */
export function joinNote(title: string, body: string, hasHeading: boolean): string {
  return hasHeading ? `# ${title}\n\n${body.trim()}\n` : `${body.trim()}\n`;
}

const KIND: Record<string, string> = { decisao: "decisão", "nao-mexer": "não mexer", diario: "diário", perfil: "perfil", processo: "processo", registro: "registro" };
export const kindLabel = (kind: string): string => KIND[kind] ?? kind;

/** Quem escreveu cada versão. A pessoa só corrige as próprias notas, então a versão "person" é da dona. */
export function authorLabel(authorKind: string, ownerName: string | undefined): string {
  if (authorKind === "agent") return ownerName ? `Agente de ${ownerName}` : "Agente";
  if (authorKind === "mirror") return "espelho do Git";
  return ownerName ?? "Equipe";
}

const ddmm = (at: Date, timeZone: string) => at.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone });

/** Histórico do cérebro (mais nova primeiro) → versões em ordem crescente, só com o texto sem título. */
export function noteVersions(history: readonly { version: number; content: string; authorKind: string; createdAt: Date }[], path: string, ownerName: string | undefined, timeZone: string): NoteVersion[] {
  return [...history]
    .sort((a, b) => a.version - b.version)
    .map((h) => ({ n: h.version, body: splitNote(h.content, path).body, by: authorLabel(h.authorKind, ownerName), at: ddmm(h.createdAt, timeZone) }));
}

export type OwnerGroup<T> = { ownerId: string | null; name: string; notes: T[] };

/** Notas agrupadas pela dona; a de quem está vendo vem primeiro, as sem dona por último. */
export function groupByOwner<T extends { personId?: string | undefined }>(notes: readonly T[], names: ReadonlyMap<string, string>, viewerId: string): OwnerGroup<T>[] {
  const groups = new Map<string | null, T[]>();
  for (const n of notes) {
    const key = n.personId ?? null;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const rank = (id: string | null) => (id === viewerId ? 0 : id === null ? 2 : 1);
  return [...groups]
    .map(([ownerId, list]) => ({ ownerId, name: ownerId ? (names.get(ownerId) ?? "Pessoa") : "Equipe", notes: list }))
    .sort((a, b) => rank(a.ownerId) - rank(b.ownerId) || a.name.localeCompare(b.name, "pt-BR"));
}
