import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL obrigatória para migrar (modelo em .env.example).");
  process.exit(1);
}
const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));
const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log(`Migrações aplicadas (${migrationsFolder}).`);
} catch (err) {
  console.error("Falha ao migrar:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
