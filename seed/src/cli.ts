// pnpm db:seed — apaga e recria SÓ a empresa de demonstração.
import { createDb, createPool } from "@echo/db";
import { resetDemo } from "./reset.ts";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL obrigatória para o seed (modelo em .env.example).");
  process.exit(1);
}

const pool = createPool(url, 1, { defaultScope: "system" });
try {
  const summary = await resetDemo(createDb(pool));
  console.log(`Empresa de demonstração recriada (${summary.orgId}).`);
  console.table(summary.counts);
} catch (err) {
  console.error("Falha no seed:", err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
