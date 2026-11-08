// Cadastro de pessoa e leitura do bonequinho, sempre em withOrg com filtro explícito de org_id.
import { auditLog, type Database, people, withOrg } from "@echo/db";
import { and, count, eq, gte } from "drizzle-orm";
import type { OnboardingStore } from "./onboarding.ts";

export function createPgOnboardingStore(db: Database): OnboardingStore {
  return {
    async createPerson(p) {
      return withOrg(db, p.orgId, async (tx) => {
        const [row] = await tx
          .insert(people)
          .values({
            orgId: p.orgId,
            name: p.name,
            role: p.role,
            timezone: p.timezone,
            workHours: p.workHours,
            teamId: p.teamId ?? null,
            jobTitle: p.jobTitle,
            skills: p.skills,
            areas: p.areas,
            languages: p.languages,
            avatar: { ...p.avatar },
          })
          .returning({ id: people.id });
        if (!row) throw new Error("pessoa não criada");
        await tx.insert(auditLog).values({ orgId: p.orgId, actor: `person:${p.actorId}`, action: "pessoa:cadastrar", target: `person:${row.id}` });
        return row;
      });
    },

    async recentCount(orgId, since) {
      const [r] = await withOrg(db, orgId, (tx) =>
        tx
          .select({ n: count() })
          .from(auditLog)
          .where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, "pessoa:cadastrar"), gte(auditLog.createdAt, since))),
      );
      return r?.n ?? 0;
    },
  };
}

/** Traços gravados da pessoa: null sem foto no cadastro, undefined se a pessoa não é da empresa. */
export async function readAvatar(db: Database, orgId: string, personId: string): Promise<Record<string, string> | null | undefined> {
  const [row] = await withOrg(db, orgId, (tx) => tx.select({ avatar: people.avatar }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId))));
  return row ? row.avatar : undefined;
}
