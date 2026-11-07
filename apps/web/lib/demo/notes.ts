/**
 * Cérebro da equipe (notas), SINTÉTICO até packages/brain chegar ao painel. Cada edição vira uma
 * versão nova e a correção humana sempre vence: a resposta do Echo passa a citar a versão corrigida.
 * As edições da demo ficam num cookie por visitante, então quem testa não atrapalha os outros.
 */

export type NoteVersion = { n: number; body: string; by: string; at: string };
export type Note = { id: string; ownerId: string; folder: "decisoes" | "nao-mexer" | "registros"; title: string; tags: string[]; versions: NoteVersion[] };
export type NoteEdit = { body: string; by: string; at: string };
export type NoteEdits = Record<string, NoteEdit[]>;

export const MAX_NOTE = 400;
export const NOTES_COOKIE = "echo_notes";
export const TIMEOUT_NOTE = "tempo-limite-pagamentos";

const v1 = (body: string, by: string, at: string): NoteVersion[] => [{ n: 1, body, by, at }];

const BASE: readonly Note[] = [
  {
    id: TIMEOUT_NOTE,
    ownerId: "fernando",
    folder: "decisoes",
    title: "Tempo limite nos pagamentos",
    tags: ["decisão", "pagamentos"],
    versions: v1("Chamadas ao provedor usam tempo limite de 5 segundos, com uma nova tentativa.", "Fernando", "03/11"),
  },
  {
    id: "modulo-pagamentos",
    ownerId: "fernando",
    folder: "nao-mexer",
    title: "Módulo de pagamentos",
    tags: ["não mexer"],
    versions: v1("Reservado até a revisão do PR 41. Mudanças aqui conflitam com o tempo limite em andamento.", "Fernando", "05/11"),
  },
  {
    id: "api-v2-formato",
    ownerId: "fernando",
    folder: "registros",
    title: "ECH-131: formato da API v2",
    tags: ["registro"],
    versions: v1("Contrato fechado na quinta. Pode seguir sem Fernando.", "Fernando", "05/11"),
  },
  {
    id: "faturas-arredondamento",
    ownerId: "carla",
    folder: "decisoes",
    title: "Arredondamento de faturas",
    tags: ["decisão", "pagamentos"],
    versions: v1("Valores são arredondados só no fim, com duas casas e meio para cima.", "Carla", "04/11"),
  },
  {
    id: "webhook-retentativas",
    ownerId: "eduardo",
    folder: "decisoes",
    title: "Retentativas do webhook de pedidos",
    tags: ["decisão", "integrações"],
    versions: v1("Até 3 retentativas, com espera crescente. Depois disso, o pedido vai para a fila de revisão.", "Eduardo", "02/11"),
  },
  {
    id: "painel-tokens",
    ownerId: "yan",
    folder: "registros",
    title: "Cores do painel",
    tags: ["registro"],
    versions: v1("As cores vêm de variáveis CSS. Nenhuma cor fixa nos componentes.", "Yan", "06/11"),
  },
];

/** Notas com as edições aplicadas, cada uma como versão nova. Edição vazia ou igual é ignorada. */
export function notesWith(edits: NoteEdits): Note[] {
  return BASE.map((note) => {
    const versions = [...note.versions];
    for (const e of edits[note.id] ?? []) {
      const body = e.body.trim().slice(0, MAX_NOTE);
      if (!body || body === versions.at(-1)!.body) continue;
      versions.push({ n: versions.length + 1, body, by: e.by, at: e.at });
    }
    return { ...note, versions };
  });
}

export const latest = (note: Note): NoteVersion => note.versions.at(-1)!;

export function findNote(notes: readonly Note[], id: string): Note | undefined {
  return notes.find((n) => n.id === id);
}

/** Lê o cookie de edições; qualquer coisa fora do formato é descartada. */
export function parseEdits(raw: string | undefined): NoteEdits {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return {};
    const out: NoteEdits = {};
    for (const [id, list] of Object.entries(data)) {
      if (!BASE.some((n) => n.id === id) || !Array.isArray(list)) continue;
      out[id] = list
        .filter((e): e is NoteEdit => !!e && typeof e.body === "string" && typeof e.by === "string" && typeof e.at === "string")
        .slice(-10)
        .map((e) => ({ body: e.body.slice(0, MAX_NOTE), by: e.by.slice(0, 40), at: e.at.slice(0, 10) }));
    }
    return out;
  } catch {
    return {};
  }
}

export function addEdit(edits: NoteEdits, id: string, edit: NoteEdit): NoteEdits {
  return { ...edits, [id]: [...(edits[id] ?? []), edit].slice(-10) };
}
