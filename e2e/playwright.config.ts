// História da demo no navegador (etapa 16): as cinco cenas de docs/produto.md → "Cenas", sem modelo e sem
// plataformas. O painel sobe em modo demonstração contra o banco do seed (`pnpm db:migrate && pnpm db:seed`).
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
if (existsSync(`${root}.env`)) process.loadEnvFile(`${root}.env`);

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, locale: "pt-BR", trace: "retain-on-failure" },
  // E2E_CHANNEL=msedge (ou chrome) usa o navegador já instalado, para quando o download do Chromium não é possível.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}) } }],
  webServer: {
    // `next` direto (o script "dev" do painel usa ${WEB_PORT:-3000}, que o Windows não expande).
    command: `node ../apps/web/node_modules/next/dist/bin/next ${process.env.CI ? "start" : "dev"} ../apps/web --port ${PORT}`,
    url: `${baseURL}/entrar`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...(process.env as Record<string, string>),
      DEMO_MODE: "true",
      // Sem modelo: as respostas saem pela regra, como manda a etapa 16 ("sem modelo, na CI").
      ANTHROPIC_API_KEY: "",
      SESSION_SECRET: process.env.SESSION_SECRET || "e2e-segredo-de-sessao-so-para-teste-local-0000",
    },
  },
});
