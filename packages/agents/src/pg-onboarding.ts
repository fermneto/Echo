// Cadastro de pessoa e leitura do bonequinho, sempre em withOrg com filtro explícito de org_id.
import { type Database, people, withOrg } from "@echo/db";
import { and, eq } from "drizzle-orm";
import type { OnboardingStore } from "./onboarding.ts";

export function createPgOnboardingStore(db: Database): OnboardingStore {
  return {
    async createPerson(p) {
      const [row] = await withOrg(db, p.orgId, (tx) =>
        tx
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
          .returning({ id: people.id }),
      );
      if (!row) throw new Error("pessoa não criada");
      return row;
    },
  };
}

/** Traços gravados da pessoa: null sem foto no cadastro, undefined se a pessoa não é da empresa. */
export async function readAvatar(db: Database, orgId: string, personId: string): Promise<Record<string, string> | null | undefined> {
  const [row] = await withOrg(db, orgId, (tx) => tx.select({ avatar: people.avatar }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId))));
  return row ? row.avatar : undefined;
}
