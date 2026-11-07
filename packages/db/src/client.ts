import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface PoolOptions {
  /**
   * Escopo de uma consulta feita fora de withOrg/asSystem.
   * - "system" (padrão por enquanto): passa pelo RLS, como antes da migração 0003. Mantém funcionando
   *   o código que ainda não usa withOrg. Vira "none" quando todas as frentes tiverem migrado.
   * - "none": fora de withOrg/asSystem, as tabelas de negócio não devolvem nada.
   */
  defaultScope?: "system" | "none";
}

export function createPool(url: string, max = 10, opts: PoolOptions = {}): pg.Pool {
  const system = (opts.defaultScope ?? "system") === "system";
  // Valor da sessão, definido na abertura da conexão (sem consulta extra): withOrg e asSystem trocam só
  // dentro da própria transação (set_config local).
  return new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 5_000, ...(system ? { options: "-c app.bypass_rls=on" } : {}) });
}

export function createDb(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/** Verifica se o banco responde. Usado por /ready. */
export async function ping(pool: pg.Pool, timeoutMs = 2_000): Promise<boolean> {
  const timeout = new Promise<false>((r) => setTimeout(() => r(false), timeoutMs).unref());
  const query = pool.query("select 1").then(() => true, () => false);
  return Promise.race([query, timeout]);
}
