import type { Viewer } from "@echo/brain";
import type { Database } from "@echo/db";
import type { Person } from "@echo/domain";
import { personIdFor } from "./agent";
import type { Note } from "./demo/notes";
import type { Persona } from "./demo/types";
import { gainsOrgId } from "./gains";
import { groupByOwner, joinNote, kindLabel, MAX_BRAIN_NOTE, noteVersions, type OwnerGroup, splitNote } from "./notes";

/**
 * Notas lidas e corrigidas no cérebro (packages/brain). Quem vê o quê é decidido pela busca do cérebro (canSee);
 * corrigir grava uma versão nova, e só a dona corrige. Import tardio do driver do banco.
 */

export type LiveNote = Pick<Note, "id" | "title" | "tags" | "versions"> & { path: string; canEdit: boolean; personId?: string };

type Ctx = { orgId: string; viewer: Viewer; me: Person | undefined; people: Person[] };

async function context(db: Database, persona: Persona): Promise<Ctx> {
  const { createPgAgentData } = await import("@echo/agents/server");
  const orgId = gainsOrgId(persona.orgId);
  const people = await createPgAgentData(db, orgId).people();
  const personId = personIdFor(persona.id);
  const me = people.find((p) => p.id === personId);
  // Papel e equipe vêm do banco, não da persona.
  const viewer: Viewer = { personId, role: me?.role ?? persona.role, ...(me?.teamId ? { teamId: me.teamId } : {}) };
  return { orgId, viewer, me, people };
}

export async function loadNotes(db: Database, persona: Persona): Promise<OwnerGroup<LiveNote>[]> {
  const ctx = await context(db, persona);
  if (ctx.viewer.role === "hr") return [];
  const { createPgBrainStore } = await import("@echo/brain/pg");
  const brain = createPgBrainStore(db, ctx.orgId);
  const found = await brain.search(ctx.viewer, "", { includeRuleManaged: true, limit: 50 });
  const names = new Map(ctx.people.map((p) => [p.id, p.name]));
  const tz = ctx.me?.timezone ?? "UTC";
  const notes = await Promise.all(
    found.map(async (n): Promise<LiveNote> => {
      const owner = n.personId ? names.get(n.personId) : undefined;
      const { title, body } = splitNote(n.content, n.path);
      const versions = noteVersions(await brain.history(ctx.viewer, n.id), n.path, owner, tz);
      return {
        id: n.id,
        title,
        path: n.path,
        tags: [kindLabel(n.kind), ...(n.managedByRule ? ["mantida por regra"] : [])],
        // O histórico é a fonte; se ainda não tiver a versão atual, ela entra no fim.
        versions: versions.at(-1)?.n === n.version ? versions : [...versions, { n: n.version, body, by: owner ?? "Equipe", at: n.updatedAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz }) }],
        canEdit: n.personId === ctx.viewer.personId && !n.managedByRule,
        ...(n.personId ? { personId: n.personId } : {}),
      };
    }),
  );
  return groupByOwner(notes, names, ctx.viewer.personId);
}

/** Corrige a nota da própria pessoa: versão nova no cérebro, com o mesmo título. */
export async function correctNote(db: Database, persona: Persona, id: string, body: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await context(db, persona);
  const { createPgBrainStore } = await import("@echo/brain/pg");
  const brain = createPgBrainStore(db, ctx.orgId);
  const note = await brain.get(ctx.viewer, id);
  if (!note) return { ok: false, error: "Nota não encontrada." };
  if (note.personId !== ctx.viewer.personId) return { ok: false, error: "Só a dona da nota pode corrigi-la." };
  if (note.managedByRule) return { ok: false, error: "Esta nota é mantida por regra e não aceita correção aqui." };
  const { title, body: current, hasHeading } = splitNote(note.content, note.path);
  const text = body.trim().slice(0, MAX_BRAIN_NOTE);
  if (text === current) return { ok: true };
  await brain.write(
    { kind: "person", id: ctx.viewer.personId },
    { id: note.id, orgId: note.orgId, personId: note.personId, path: note.path, kind: note.kind, content: joinNote(title, text, hasHeading), visibility: note.visibility, managedByRule: note.managedByRule },
  );
  return { ok: true };
}
