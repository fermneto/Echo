import { createDb, createPool, type Database } from "@echo/db";
import { loadConfig } from "@echo/config";

/** Banco do painel (um pool por processo). Sem DATABASE_URL, só o login por persona da demo funciona. */
let db: Database | null | undefined;
export function panelDb(): Database | null {
  if (db !== undefined) return db;
  const url = loadConfig("web").DATABASE_URL;
  db = url ? createDb(createPool(url, 5)) : null;
  return db;
}
