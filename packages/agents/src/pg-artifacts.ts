// Resumos do dia (daily_artifacts) em Postgres. Toda consulta em withOrg com filtro explícito de org_id.
import type { ArtifactSpec, DayFacts } from "@echo/artifacts";
import { dailyArtifacts, type Database, withOrg } from "@echo/db";
import { and, eq, sql } from "drizzle-orm";
import type { DailyArtifactStore, StoredArtifact } from "./day-summary.ts";

const KIND = "nota";

export function createPgArtifactStore(db: Database, orgId: string): DailyArtifactStore {
  const run = <T>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(db, orgId, fn);
  return {
    async save(personId, date, a) {
      const values = { spec: a.spec, facts: a.facts, model: a.model ?? null, state: a.state, updatedAt: new Date() };
      await run((tx) =>
        tx
          .insert(dailyArtifacts)
          .values({ orgId, personId, date, kind: KIND, ...values })
          .onConflictDoUpdate({
            target: [dailyArtifacts.orgId, dailyArtifacts.personId, dailyArtifacts.date, dailyArtifacts.kind],
            set: { ...values, version: sql`${dailyArtifacts.version} + 1` },
          }),
      );
    },
    async get(personId, date) {
      const [r] = await run((tx) =>
        tx.select().from(dailyArtifacts).where(and(eq(dailyArtifacts.orgId, orgId), eq(dailyArtifacts.personId, personId), eq(dailyArtifacts.date, date), eq(dailyArtifacts.kind, KIND))).limit(1),
      );
      if (!r || !r.facts) return null;
      const out: StoredArtifact = { spec: r.spec as ArtifactSpec, facts: r.facts as DayFacts, state: r.state === "rendered" ? "rendered" : "fallback", ...(r.model ? { model: r.model } : {}) };
      return out;
    },
  };
}
