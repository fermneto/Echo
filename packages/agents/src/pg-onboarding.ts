// Cadastro de pessoa e leitura do bonequinho, sempre em withOrg com filtro explícito de org_id.
import { agentRuns, auditLog, type Database, people, withOrg } from "@echo/db";
import { and, count, eq, gte, isNull, ne } from "drizzle-orm";
import { parseAvatarTraits, traitsFromSeed } from "@echo/domain";
import type { OnboardingStore, ResumeProfile } from "./onboarding.ts";
import type { AvatarStore } from "./redo-avatar.ts";

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

/**
 * Perfil editado à mão na ficha (cargo, habilidades, áreas e idiomas), já validado por `cleanProfile`.
 * Grava quem editou em `audit_log`. Devolve false se a pessoa não é da empresa ou está desligada.
 */
export async function updateProfile(db: Database, orgId: string, personId: string, profile: ResumeProfile, actorId: string): Promise<boolean> {
  return withOrg(db, orgId, async (tx) => {
    const done = await tx
      .update(people)
      .set({ jobTitle: profile.jobTitle, skills: profile.skills, areas: profile.areas, languages: profile.languages })
      .where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt)))
      .returning({ id: people.id });
    if (!done.length) return false;
    await tx.insert(auditLog).values({ orgId, actor: `person:${actorId}`, action: "perfil:editar", target: `person:${personId}` });
    return true;
  });
}

/** Bonequinho de quem já está cadastrado: ler os traços, trocar com audit_log e contar as leituras de foto. */
export function createPgAvatarStore(db: Database): AvatarStore {
  return {
    async current(orgId, personId) {
      const [row] = await withOrg(db, orgId, (tx) =>
        tx.select({ avatar: people.avatar }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt))),
      );
      if (!row) return undefined;
      return row.avatar ? parseAvatarTraits(row.avatar, traitsFromSeed(personId)).traits : traitsFromSeed(personId);
    },

    async update(orgId, personId, traits, actorId, action) {
      return withOrg(db, orgId, async (tx) => {
        const done = await tx
          .update(people)
          .set({ avatar: { ...traits } })
          .where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt)))
          .returning({ id: people.id });
        if (!done.length) return false;
        await tx.insert(auditLog).values({ orgId, actor: `person:${actorId}`, action, target: `person:${personId}` });
        return true;
      });
    },

    async recentRedos(orgId, since) {
      // Conta as chamadas ao modelo (agent_runs), não só as trocas gravadas: foto ilegível também gasta.
      const [r] = await withOrg(db, orgId, (tx) =>
        tx
          .select({ n: count() })
          .from(agentRuns)
          .where(and(eq(agentRuns.orgId, orgId), eq(agentRuns.flow, "avatar_redo"), ne(agentRuns.result, "skipped"), gte(agentRuns.createdAt, since))),
      );
      return r?.n ?? 0;
    },
  };
}
