// Contas da pessoa (identities) no Slack, no GitHub e no Linear, ligadas pelo RH ou pela liderança no cadastro
// e na ficha. Uma conta por plataforma por pessoa; a mesma conta nunca fica com duas pessoas. Os ids das contas
// não vão para o audit_log nem para log: lá fica só quem ligou, a pessoa e as plataformas.
import { ACCOUNT_PLATFORMS, type AccountLink, type AccountPlatform } from "@echo/domain";
import { auditLog, type Database, identities, people, type Tx, withOrg } from "@echo/db";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";

export type PersonAccounts = Partial<Record<AccountPlatform, { externalId: string; login: string | null }>>;

export type SaveAccountsResult = { status: "saved" } | { status: "not_found" } | { status: "conflict"; platform: AccountPlatform; otherName: string };

/** A mesma conta já ligada a outra pessoa da empresa. */
export class AccountConflictError extends Error {
  constructor(
    readonly platform: AccountPlatform,
    readonly otherName: string,
  ) {
    super(`conta de ${platform} já ligada a outra pessoa`);
  }
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
 * Troca as contas da pessoa nas plataformas do cadastro pelas informadas, dentro da transação (plataforma sem
 * conta informada fica sem conta). Lança AccountConflictError se alguma já é de outra pessoa; nada muda.
 */
export async function replaceAccounts(tx: Tx, orgId: string, personId: string, links: readonly AccountLink[]): Promise<void> {
  if (links.length) {
    // GitHub: o mesmo login pode ter entrado com outro id (o número da conta); confere pelo login também.
    const taken = await tx
      .select({ platform: identities.platform, name: people.name })
      .from(identities)
      .innerJoin(people, and(eq(people.id, identities.personId), eq(people.orgId, orgId)))
      .where(
        and(
          eq(identities.orgId, orgId),
          ne(identities.personId, personId),
          or(...links.map((l) => and(eq(identities.platform, l.platform), l.login ? or(eq(identities.externalId, l.externalId), eq(identities.login, l.login)) : eq(identities.externalId, l.externalId)))),
        ),
      )
      .limit(1);
    if (taken[0]) throw new AccountConflictError(taken[0].platform as AccountPlatform, taken[0].name);
  }
  await tx.delete(identities).where(and(eq(identities.orgId, orgId), eq(identities.personId, personId), inArray(identities.platform, [...ACCOUNT_PLATFORMS])));
  if (links.length) await tx.insert(identities).values(links.map((l) => ({ orgId, personId, platform: l.platform, externalId: l.externalId, login: l.login })));
}

/** Ficha da pessoa: troca as contas e registra quem trocou e quais plataformas ficaram ligadas. */
export async function saveAccounts(db: Database, orgId: string, personId: string, links: readonly AccountLink[], actorId: string): Promise<SaveAccountsResult> {
  try {
    return await withOrg(db, orgId, async (tx) => {
      const [p] = await tx.select({ id: people.id }).from(people).where(and(eq(people.orgId, orgId), eq(people.id, personId), isNull(people.offboardedAt)));
      if (!p) return { status: "not_found" } as const;
      await replaceAccounts(tx, orgId, personId, links);
      const on = links.map((l) => l.platform).sort().join(",") || "nenhuma";
      await tx.insert(auditLog).values({ orgId, actor: `person:${actorId}`, action: `pessoa:contas:${on}`, target: `person:${personId}` });
      return { status: "saved" } as const;
    });
  } catch (err) {
    if (err instanceof AccountConflictError) return { status: "conflict", platform: err.platform, otherName: err.otherName };
    throw err;
  }
}
