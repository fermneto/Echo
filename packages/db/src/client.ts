import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createPool(url: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 5_000 });
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
