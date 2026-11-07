// BrainStore em Postgres (etapa 5): notas, versões, busca de texto e permissões.
// Uma instância por empresa; toda consulta roda em withOrg, então o RLS também protege.
import { brainNotes, brainNoteVersions, people, type Database, type Tx, withOrg } from "@echo/db";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { BrainNote, BrainStore, NoteKind, SearchFilters, Viewer, Visibility } from "./index.ts";
import { canSee, isCorrectionPath } from "./permissions.ts";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
/** Mesma expressão do índice GIN da migração 0004. */
const document = sql`to_tsvector('portuguese', ${brainNotes.path} || ' ' || ${brainNotes.content})`;

export class CorrectionProtectedError extends Error {
  override name = "CorrectionProtectedError";
}

type Row = typeof brainNotes.$inferSelect & { ownerTeamId: string | null };

function toNote(r: Row): BrainNote {
  return {
    id: r.id,
    orgId: r.orgId,
    ...(r.personId ? { personId: r.personId } : {}),
    path: r.path,
    kind: r.kind as NoteKind,
    content: r.content,
    visibility: r.visibility as Visibility,
    version: r.version,
    managedByRule: r.managedByRule,
    updatedAt: r.updatedAt,
  };
}

const visible = (viewer: Viewer, r: Row) => canSee(viewer, toNote(r), { teamId: r.ownerTeamId });

/** O mesmo filtro de canSee, em SQL, para o limite da busca valer só sobre notas permitidas. */
function visibilityFilter(viewer: Viewer): SQL {
  const team = viewer.teamId ?? null;
  const sameTeam = sql`(${team}::uuid is not null and ${owner.teamId} = ${team}::uuid)`;
  return sql`(
    ${brainNotes.personId} = ${viewer.personId}::uuid
    or (${brainNotes.visibility} = 'person' and ${viewer.role} = 'leader' and ${sameTeam})
    or (${brainNotes.visibility} = 'team' and (${brainNotes.personId} is null or ${sameTeam}))
  )`;
}

const owner = alias(people, "owner");

const selection = {
  id: brainNotes.id,
  orgId: brainNotes.orgId,
  personId: brainNotes.personId,
  path: brainNotes.path,
  kind: brainNotes.kind,
  content: brainNotes.content,
  visibility: brainNotes.visibility,
  version: brainNotes.version,
  sha: brainNotes.sha,
  managedByRule: brainNotes.managedByRule,
  mirrorConflictAt: brainNotes.mirrorConflictAt,
  updatedAt: brainNotes.updatedAt,
  ownerTeamId: owner.teamId,
};

const ownerOn = and(eq(owner.id, brainNotes.personId), eq(owner.orgId, brainNotes.orgId));

// O filtro por org_id é explícito em toda consulta, além do RLS: superusuário (banco local, CI) passa pelo RLS.
async function loadRow(tx: Tx, orgId: string, id: string): Promise<Row | undefined> {
  const [row] = await tx.select(selection).from(brainNotes).leftJoin(owner, ownerOn).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, id)));
  return row as Row | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export function createPgBrainStore(db: Database, orgId: string): BrainStore {
  return {
    async get(viewer, id) {
      if (viewer.role === "hr" || !UUID.test(id)) return null;
      const row = await withOrg(db, orgId, (tx) => loadRow(tx, orgId, id));
      return row && visible(viewer, row) ? toNote(row) : null;
    },

    async search(viewer, query, filters: SearchFilters = {}) {
      if (viewer.role === "hr") return [];
      const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const q = query.trim();
      const conds: SQL[] = [sql`${brainNotes.orgId} = ${orgId}::uuid`, visibilityFilter(viewer)];
      if (!filters.includeRuleManaged) conds.push(sql`${brainNotes.managedByRule} = false`);
      if (filters.personId) conds.push(sql`${brainNotes.personId} = ${filters.personId}::uuid`);
      if (filters.taskKey) conds.push(sql`(${brainNotes.path} || ' ' || ${brainNotes.content}) ilike ${`%${escapeLike(filters.taskKey)}%`}`);
      if (filters.branch) conds.push(sql`(${brainNotes.path} || ' ' || ${brainNotes.content}) ilike ${`%${escapeLike(filters.branch)}%`}`);
      if (filters.prNumber !== undefined) {
        conds.push(sql`(${brainNotes.path} || ' ' || ${brainNotes.content}) ~* ${`(\\mPR[ #-]?|/pull/)${Math.trunc(filters.prNumber)}\\M`}`);
      }
      const tsQuery = sql`websearch_to_tsquery('portuguese', ${q})`;
      if (q) conds.push(sql`${document} @@ ${tsQuery}`);
      const order = q ? sql`ts_rank(${document}, ${tsQuery}) desc, ${brainNotes.updatedAt} desc` : sql`${brainNotes.updatedAt} desc`;

      const rows = await withOrg(db, orgId, (tx) =>
        tx
          .select(selection)
          .from(brainNotes)
          .leftJoin(owner, ownerOn)
          .where(and(...conds))
          .orderBy(order)
          .limit(limit),
      );
      // Segunda checagem, em código: nada passa sem canSee.
      return (rows as Row[]).filter((r) => visible(viewer, r)).map(toNote);
    },

    async write(author, note) {
      if (note.orgId !== orgId) throw new Error("write: nota de outra empresa");
      return withOrg(db, orgId, async (tx) => {
        const [existing] = note.id
          ? await tx.select().from(brainNotes).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, note.id)))
          : await tx.select().from(brainNotes).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.path, note.path)));
        if (note.id && !existing) throw new Error("write: nota não encontrada");
        if (author.kind === "agent" && (isCorrectionPath(note.path) || (existing && isCorrectionPath(existing.path)))) {
          throw new CorrectionProtectedError(`Agentes não sobrescrevem correções da pessoa (${note.path}).`);
        }
        const values = {
          personId: note.personId ?? null,
          path: note.path,
          kind: note.kind,
          content: note.content,
          visibility: note.visibility,
          managedByRule: note.managedByRule,
        };
        let saved: typeof brainNotes.$inferSelect | undefined;
        if (existing) {
          [saved] = await tx
            .update(brainNotes)
            .set({ ...values, version: existing.version + 1, updatedAt: new Date() })
            .where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, existing.id)))
            .returning();
        } else {
          [saved] = await tx.insert(brainNotes).values({ ...values, orgId, version: 1 }).returning();
        }
        if (!saved) throw new Error("write: falha ao gravar a nota");
        await tx.insert(brainNoteVersions).values({
          orgId,
          noteId: saved.id,
          version: saved.version,
          content: saved.content,
          authorId: author.id ?? null,
          authorKind: author.kind,
        });
        return toNote({ ...saved, ownerTeamId: null });
      });
    },

    async history(viewer, id) {
      if (viewer.role === "hr" || !UUID.test(id)) return [];
      return withOrg(db, orgId, async (tx) => {
        const row = await loadRow(tx, orgId, id);
        if (!row || !visible(viewer, row)) return [];
        return tx
          .select({ version: brainNoteVersions.version, content: brainNoteVersions.content, authorKind: brainNoteVersions.authorKind, createdAt: brainNoteVersions.createdAt })
          .from(brainNoteVersions)
          .where(and(eq(brainNoteVersions.orgId, orgId), eq(brainNoteVersions.noteId, id)))
          .orderBy(desc(brainNoteVersions.version));
      });
    },
  };
}
