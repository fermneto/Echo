// Leitura das execuções (`agent_runs`) e da auditoria (`audit_log`) para o painel "Custo e execuções".
// Toda consulta em withOrg com filtro explícito de org_id. Só leitura: nada aqui escreve.
import { agentRuns, auditLog, type Database, orgs, people, withOrg } from "@echo/db";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

export type RunRow = typeof agentRuns.$inferSelect;
export type AuditRow = typeof auditLog.$inferSelect;

export interface RunsView {
  runs: RunRow[];
  audit: AuditRow[];
  /** Soma de cost_usd de todas as execuções da empresa desde `monthStart`. */
  monthSpentUsd: number;
  /** Nome de cada pessoa da empresa, para mostrar "person:<id>" como gente. */
  names: Record<string, string>;
}

export async function readRuns(db: Database, orgId: string, opts: { monthStart: Date; limit?: number }): Promise<RunsView> {
  const limit = opts.limit ?? 50;
  return withOrg(db, orgId, async (tx) => {
    const runs = await tx.select().from(agentRuns).where(eq(agentRuns.orgId, orgId)).orderBy(desc(agentRuns.createdAt)).limit(limit);
    const audit = await tx.select().from(auditLog).where(eq(auditLog.orgId, orgId)).orderBy(desc(auditLog.createdAt)).limit(limit);
    const [spent] = await tx
      .select({ total: sql<string | null>`sum(${agentRuns.costUsd})` })
      .from(agentRuns)
      .where(and(eq(agentRuns.orgId, orgId), gte(agentRuns.createdAt, opts.monthStart)));
    const who = await tx.select({ id: people.id, name: people.name }).from(people).where(eq(people.orgId, orgId));
    return { runs, audit, monthSpentUsd: Number(spent?.total ?? 0), names: Object.fromEntries(who.map((p) => [p.id, p.name])) };
  });
}

export interface OrgSettingsView {
  name: string;
  monthlyLimitUsd: number;
  hardLimitUsd: number;
  isDemo: boolean;
  /** Quantas pessoas ativas há em cada papel (member, leader, hr). */
  roles: Record<string, number>;
}

/** Limites de custo e papéis da empresa, para a Configuração e o limite do mês. */
export async function readOrgSettings(db: Database, orgId: string): Promise<OrgSettingsView | null> {
  return withOrg(db, orgId, async (tx) => {
    const [org] = await tx
      .select({ name: orgs.name, monthlyLimitUsd: orgs.monthlyLimitUsd, hardLimitUsd: orgs.hardLimitUsd, isDemo: orgs.isDemo })
      .from(orgs)
      .where(eq(orgs.id, orgId));
    if (!org) return null;
    const rows = await tx
      .select({ role: people.role, n: sql<number>`count(*)::int` })
      .from(people)
      .where(and(eq(people.orgId, orgId), eq(people.active, true), isNull(people.offboardedAt)))
      .groupBy(people.role);
    return {
      name: org.name,
      monthlyLimitUsd: Number(org.monthlyLimitUsd),
      hardLimitUsd: Number(org.hardLimitUsd),
      isDemo: org.isDemo,
      roles: Object.fromEntries(rows.map((r) => [r.role, Number(r.n)])),
    };
  });
}
