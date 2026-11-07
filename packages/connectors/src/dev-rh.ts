// Teste real do aviso de RH.
//   pnpm integracoes:rh                      → gera (ou troca) o segredo da empresa de teste e mostra a URL
//   pnpm integracoes:rh --enviar --matricula 123 [--inicio 2026-11-10] [--fim 2026-11-21] [--cancelar evento-x]
// O envio assina com x-echo-timestamp e x-echo-signature, como um sistema de RH faria.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { createDb, createPool, orgs } from "@echo/db";
import { eq } from "drizzle-orm";
import { TokenCipher } from "./crypto.ts";
import { hrSecret, rotateHrSecret } from "./hr.ts";
import { sign } from "./signatures.ts";

const { values: a } = parseArgs({
  args: process.argv.slice(2).filter((x) => x !== "--"),
  options: { enviar: { type: "boolean" }, matricula: { type: "string" }, inicio: { type: "string" }, fim: { type: "string" }, cancelar: { type: "string" }, api: { type: "string" } },
});
const env = process.env;
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};
if (!env.DATABASE_URL) fail("DATABASE_URL ausente no .env.");
if (!env.ENCRYPTION_KEY) fail("ENCRYPTION_KEY ausente no .env (openssl rand -hex 32; a mesma da API).");
const cipher = new TokenCipher(env.ENCRYPTION_KEY!);
const pool = createPool(env.DATABASE_URL!, 2);
const db = createDb(pool);
const [org] = await db.select().from(orgs).where(eq(orgs.name, env.DEMO_ORG_NAME ?? "Empresa de teste (integrações)"));
if (!org) fail("Empresa de teste não encontrada: rode antes pnpm integracoes:ligar.");
const api = (a.api ?? env.API_PUBLIC_URL ?? `http://localhost:${env.API_PORT ?? 3001}`).replace(/\/$/, "");
const url = `${api}/webhooks/rh/o/${org!.id}`;

if (!a.enviar) {
  const secret = await rotateHrSecret(db, cipher, org!.id);
  console.log(`URL do aviso de RH: ${url}`);
  console.log(`Segredo (mostrado só agora; trocar invalida o anterior): ${secret}`);
  console.log('Corpo: {"id":"evento-1","employee_id":"123","starts_at":"2026-11-10T00:00:00-03:00","ends_at":"2026-11-21T23:59:59-03:00","kind":"vacation"}');
  console.log('Cabeçalhos: x-echo-timestamp (segundos) e x-echo-signature = HMAC-SHA256 hex de "<timestamp>.<corpo>"');
  await pool.end();
  process.exit(0);
}

const secret = (await hrSecret(db, cipher, org!.id)) ?? fail("Empresa sem segredo de RH: rode antes pnpm integracoes:rh (sem --enviar).");
await pool.end();
const body = a.cancelar
  ? JSON.stringify({ id: a.cancelar, action: "cancel" })
  : JSON.stringify({
      id: `teste-${randomUUID().slice(0, 8)}`,
      employee_id: a.matricula ?? fail("--matricula obrigatória (a matrícula de alguém em DEMO_IDENTITIES)"),
      starts_at: `${a.inicio ?? new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}T00:00:00-03:00`,
      ends_at: `${a.fim ?? new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10)}T23:59:59-03:00`,
      kind: "vacation",
      motivo: "este campo é descartado pelo Echo",
    });
const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...sign.hr(secret, body, Math.floor(Date.now() / 1000)) }, body });
console.log(`POST ${url}`);
console.log(`Corpo enviado: ${body}`);
console.log(`Resposta: ${res.status} ${await res.text()}`);
