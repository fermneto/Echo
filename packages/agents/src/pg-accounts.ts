// Contas da pessoa (identities) no Slack, no GitHub e no Linear, ligadas pelo RH ou pela liderança no cadastro
// e na ficha. Uma conta por plataforma por pessoa; a mesma conta nunca fica com duas pessoas. Os ids das contas
// não vão para o audit_log nem para log: lá fica só quem ligou, a pessoa e as plataformas.
import { ACCOUNT_PLATFORMS, type AccountLink, type AccountPlatform } from "@echo/domain";
import { auditLog, type Database, identities, people, type Tx, withOrg } from "@echo/db";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

export type PersonAccounts = Partial<Record<AccountPlatform, { externalId: string; login: string | null }>>;

/** `otherName` null: a conta foi ligada a outra pessoa por um pedido simultâneo (índice único), sem nome conhecido. */
export type SaveAccountsResult = { status: "saved" } | { status: "not_found" } | { status: "conflict"; platform: AccountPlatform; otherName: string | null };

/** A mesma conta já ligada a outra pessoa da empresa. `otherName` null quando foi a corrida no índice único. */
export class AccountConflictError extends Error {
  constructor(
    readonly platform: AccountPlatform,
    readonly otherName: string | null,
  ) {
    super(`conta de ${platform} já ligada a outra pessoa`);
  }
}

/** 23505 (unique_violation), direto ou dentro do erro do Drizzle. */
function uniqueViolation(err: unknown): { detail?: string; constraint?: string } | null {
  for (const e of [err, (err as { cause?: unknown } | undefined)?.cause]) {
    const pgErr = e as { code?: string; detail?: string; constraint?: string } | undefined;
    if (pgErr?.code === "23505") return pgErr;
  }
  return null;
}

/** Contas atuais da pessoa nas plataformas do cadastro. */
export async function readAccounts(db: Database, orgId: string, personId: string): Promise<PersonAccounts> {
  const rows = await withOrg(db, orgId, (tx) =>
    tx
      .select({ platform: identities.platform, externalId: identities.externalId, login: identities.login })
      .from(identities)
      .where(and(eq(identities.orgId, orgId), eq(identities.personId, personId), inArray(identities.platform, [...ACCOUNT_PLATFORMS]))),
  );
  const out: PersonAccounts = {};
  for (const r of rows) out[r.platform as AccountPlatform] = { externalId: r.externalId, login: r.login };
  return out;
}

/**
 * Troca as contas da pessoa nas plataformas `platforms` pelas informadas, dentro da transação (plataforma sem
 * conta informada fica sem conta; plataforma fora de `platforms` não muda). Lança AccountConflictError se alguma
 * já é de outra pessoa, inclusive quando outro pedido simultâneo ligou a mesma conta (índice único); nada muda.
 */
export async function replaceAccounts(tx: Tx, orgId: string, personId: string, links: readonly AccountLink[], platforms: readonly AccountPlatform[] = ACCOUNT_PLATFORMS): Promise<void> {
  const scoped = links.filter((l) => platforms.includes(l.platform));
  if (scoped.length) {
    // GitHub: o mesmo login pode ter entrado com outro id (o número da conta) e com outra caixa; confere pelo login
    // em minúsculas também, como o ingest.
    const taken = await tx
      .select({ platform: identities.platform, name: people.name })
      .from(identities)
      .innerJoin(people, and(eq(people.id, identities.personId), eq(people.orgId, orgId)))
      .where(
        and(
          eq(identities.orgId, orgId),
          ne(identities.personId, personId),
          or(
            ...scoped.map((l) =>
              and(eq(identities.platform, l.platform), l.login ? or(eq(identities.externalId, l.externalId), eq(sql`lower(${identities.login})`, l.login.toLowerCase())) : eq(identities.externalId, l.externalId)),
            ),
          ),
        ),
      )
      .limit(1);
    if (taken[0]) throw new AccountConflictError(taken[0].platform as AccountPlatform, taken[0].name);
  }
  if (!platforms.length) return;
  await tx.delete(identities).where(and(eq(identities.orgId, orgId), eq(identities.personId, personId), inArray(identities.platform, [...platforms])));
  if (!scoped.length) return;
  try {
    await tx.insert(identities).values(scoped.map((l) => ({ orgId, personId, platform: l.platform, externalId: l.externalId, login: l.login })));
  } catch (err) {
    // Corrida: outro pedido ligou a mesma conta entre a conferência e a gravação. O detalhe do Postgres traz o id;
    // dele só sai a plataforma, e nada vai para log.
    const dup = uniqueViolation(err);
    if (!dup) throw err;
    const platform = scoped.find((l) => dup.detail?.includes(`, ${l.platform}, `))?.platform ?? scoped[0]!.platform;
    throw new AccountConflictError(platform, null);
  }
}

/** Ação do audit_log com as plataformas ligadas, sem os ids das contas. */
export function accountsAuditAction(links: readonly AccountLink[]): string {
  return `pessoa:contas:${links.map((l) => l.platform).sort().join(",") || "nenhuma"}`;
}

/**
 * Ficha da pessoa: troca as contas nas plataformas `platforms` (as que quem pede pode ligar) e registra quem
 * trocou e quais plataformas ficaram ligadas. Conta de outra pessoa, inclusive na corrida, vira `conflict`.
 */
export async function saveAccounts(db: Database, orgId: string, personId: string, links: readonly AccountLink[], actorId: string, platforms: readonly AccountPlatform[] = ACCOUNT_PLATFORMS): Promise<SaveAccountsResult> {
  try {
    return await withOrg(db, orgId, async (tx) => {
      const [p] = await tx.select({ id: people.id }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt)));
      if (!p) return { status: "not_found" } as const;
      const scoped = links.filter((l) => platforms.includes(l.platform));
      await replaceAccounts(tx, orgId, personId, scoped, platforms);
      await tx.insert(auditLog).values({ orgId, actor: `person:${actorId}`, action: accountsAuditAction(scoped), target: `person:${personId}` });
      return { status: "saved" } as const;
    });
  } catch (err) {
    if (err instanceof AccountConflictError) return { status: "conflict", platform: err.platform, otherName: err.otherName };
    // A corrida também pode estourar no commit, fora de replaceAccounts.
    if (uniqueViolation(err)) return { status: "conflict", platform: links[0]?.platform ?? "slack", otherName: null };
    throw err;
  }
}
