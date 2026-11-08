import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface PoolOptions {
  /**
   * Escopo de uma consulta feita fora de withOrg/asSystem.
   * - "none" (padrão): fora de withOrg/asSystem, as tabelas de negócio não devolvem nada nem aceitam escrita.
   *   Todos os serviços (api, worker, reviewer, painel) já usam withOrg ou asSystem.
   * - "system": passa pelo RLS na conexão inteira. Só para ferramentas de sistema rodadas à mão: seed,
   *   scripts `dev-*`, reconciliação manual e a leitura da empresa de demonstração pelo evals.
   */
  defaultScope?: "system" | "none";
  /** Tempo para abrir uma conexão (padrão 5 s). Comandos rodados de fora da Render precisam de mais. */
  connectTimeoutMs?: number;
}

export function createPool(url: string, max = 10, opts: PoolOptions = {}): pg.Pool {
  const system = opts.defaultScope === "system";
  // Valor da sessão, definido na abertura da conexão (sem consulta extra): withOrg e asSystem trocam só
  // dentro da própria transação (set_config local).
  return new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: opts.connectTimeoutMs ?? 5_000, ...(system ? { options: "-c app.bypass_rls=on" } : {}) });
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
