// Confere o GitHub App e mostra o que o seed precisa (DEMO_GITHUB_INSTALLATION_ID e repositórios).
// Uso: pnpm --filter @echo/connectors github:check [id da instalação]
import { GithubApp } from "./github-client.ts";

const { GITHUB_APP_ID: appId, GITHUB_PRIVATE_KEY: key } = process.env;
if (!appId || !key) {
  console.error("GITHUB_APP_ID e GITHUB_PRIVATE_KEY ausentes no .env (modelo em .env.example).");
  process.exit(1);
}
const app = new GithubApp({ appId, privateKey: key });
try {
  const { data: me } = await app.request<{ slug: string; name: string }>("/app", async () => app.jwt());
  console.log(`App ok: ${me.name} (${me.slug})`);
  const { data: installs } = await app.request<{ id: number; account: { login: string } }[]>("/app/installations", async () => app.jwt());
  for (const i of installs) console.log(`  instalação ${i.id} em ${i.account.login}`);
  const chosen = process.argv[2] ?? (installs.length === 1 ? String(installs[0]!.id) : undefined);
  if (chosen) {
    const repos = await app.forInstallation(chosen).listRepositories();
    console.log(`Instalação ${chosen} (DEMO_GITHUB_INSTALLATION_ID) vê ${repos.length} repositórios: ${repos.join(", ")}`);
  }
} catch (err) {
  console.error("Falha ao falar com o GitHub:", err instanceof Error ? err.message : err);
  process.exit(1);
}
