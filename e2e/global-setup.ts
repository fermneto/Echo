// Antes da história: recria a empresa de demonstração (o mesmo que `pnpm db:seed`), para que a história
// possa rodar várias vezes. Só mexe na empresa do seed, com dados sintéticos. E2E_SKIP_SEED=true pula.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default function globalSetup() {
  if (process.env.E2E_SKIP_SEED === "true") return;
  if (!process.env.DATABASE_URL) throw new Error("e2e: defina DATABASE_URL (banco migrado; ver docs/integracoes/ambiente.md)");
  const opts = { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit", env: { ...process.env, ANTHROPIC_API_KEY: "" } } as const;
  execSync("pnpm db:seed", opts);
  // Cena 4: o relatório da semana que já fechou, com texto por regra (o mesmo build da agenda do worker).
  execSync("pnpm relatorio:agora", opts);
}
