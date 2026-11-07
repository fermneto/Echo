// DailyNoteStore em Postgres. Toda consulta em withOrg com filtro explícito de org_id.
import { dailyNotes, type Database, identities, withOrg } from "@echo/db";
import type { DailyNoteState } from "@echo/domain";
import { and, eq, inArray } from "drizzle-orm";
import type { DailyNoteStore, StoredDailyNote } from "./daily-note.ts";
import { mark } from "./pg-data.ts";

const opt = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

export function createPgDailyNoteStore(db: Database, orgId: string): DailyNoteStore {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);
  const slackOf = (personId: string) =>
    run((tx) => tx.select({ ext: identities.externalId }).from(identities).where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack"), eq(identities.personId, personId))).limit(1));

  return {
    async get(personId, date) {
      const [r] = await run((tx) => tx.select().from(dailyNotes).where(and(eq(dailyNotes.orgId, orgId), eq(dailyNotes.personId, personId), eq(dailyNotes.date, date))));
      if (!r) return null;
      const note: StoredDailyNote = {
        personId: r.personId,
        date: r.date,
        stoppedAt: opt(r.stoppedAt),
        blocked: opt(r.blocked),
        released: r.released.map(mark),
        reserved: r.reserved.map(mark),
        state: r.state as DailyNoteState,
        confirmedAt: opt(r.confirmedAt),
        createdAt: r.createdAt,
      };
      return note;
    },

    async createDraft(note, createdAt) {
      const rows = await run((tx) =>
        tx
          .insert(dailyNotes)
          .values({ orgId, personId: note.personId, date: note.date, stoppedAt: note.stoppedAt ?? null, blocked: note.blocked ?? null, released: note.released, reserved: note.reserved, state: "draft", createdAt })
          .onConflictDoNothing()
          .returning({ id: dailyNotes.id }),
      );
      return rows.length > 0;
    },

    async setState(personId, date, from, to, patch = {}) {
      const rows = await run((tx) =>
        tx
          .update(dailyNotes)
          .set({
            state: to,
            ...(patch.stoppedAt !== undefined ? { stoppedAt: patch.stoppedAt || null } : {}),
            ...(patch.blocked !== undefined ? { blocked: patch.blocked || null } : {}),
            ...(patch.released ? { released: patch.released } : {}),
            ...(patch.reserved ? { reserved: patch.reserved } : {}),
            ...(patch.confirmedAt ? { confirmedAt: patch.confirmedAt } : {}),
          })
          .where(and(eq(dailyNotes.orgId, orgId), eq(dailyNotes.personId, personId), eq(dailyNotes.date, date), inArray(dailyNotes.state, from)))
          .returning({ id: dailyNotes.id }),
      );
      return rows.length > 0;
    },

    async slackUserOf(personId) {
      const [r] = await slackOf(personId);
      return r?.ext ?? null;
    },

    async personBySlackUser(externalId) {
      const [r] = await run((tx) =>
        tx.select({ personId: identities.personId }).from(identities).where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack"), eq(identities.externalId, externalId))).limit(1),
      );
      return r?.personId ?? null;
    },
  };
}
