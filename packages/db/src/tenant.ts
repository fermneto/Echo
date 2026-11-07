// Isolamento por empresa (etapa 2). As políticas de RLS da migração 0003 leem duas variáveis da transação:
//   app.org_id     — a empresa da transação (withOrg)
//   app.bypass_rls — 'on' só em rotinas de sistema (asSystem)
// Sem nenhuma das duas, as tabelas de negócio não devolvem nada e não aceitam escrita.
import { sql } from "drizzle-orm";
import type { Database } from "./client.ts";

export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Roda `fn` numa transação que só enxerga e só escreve linhas da empresa `orgId`. */
export async function withOrg<T>(db: Database, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(orgId)) throw new Error(`withOrg: org_id inválido (${orgId})`);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'off', true), set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * Roda `fn` numa transação de sistema, que passa pelo RLS. Só para o que precisa ver várias empresas
 * ou ainda não sabe qual é: seed, roteamento de webhook, jobs agendados que percorrem as empresas.
 * Dentro de um fluxo de uma empresa, use withOrg.
 */
export async function asSystem<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.bypass_rls', 'on', true), set_config('app.org_id', '', true)`);
    return fn(tx);
  });
}
