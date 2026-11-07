// Diagnóstico das integrações: o que está configurado, o que a plataforma aceita e o que falta.
// Só leitura: não escreve em nenhuma plataforma nem no banco. Uso: pnpm integracoes:diagnostico
import { ConfigError, loadConfig } from "@echo/config";
import { asSystem, createDb, createPool, identities, installationRoutes, orgs, people, withOrg } from "@echo/db";
import { and, eq, sql } from "drizzle-orm";
import { GithubApp } from "./github-client.ts";
import { LinearTracker } from "./linear-client.ts";
import { platformsFromEnv } from "./platforms.ts";
import { SlackChat } from "./slack-client.ts";

type Status = "ok" | "falta" | "erro" | "aviso";
interface Item {
  area: string;
  check: string;
  status: Status;
  detail?: string;
  /** Onde resolver (guia em docs/integracoes). */
  fix?: string;
}

const env = process.env;
const items: Item[] = [];
const add = (area: string, check: string, status: Status, detail?: string, fix?: string) => items.push({ area, check, status, ...(detail ? { detail } : {}), ...(fix ? { fix } : {}) });
const has = (...keys: string[]) => keys.every((k) => Boolean(env[k]?.trim()));
const missing = (...keys: string[]) => keys.filter((k) => !env[k]?.trim());
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 160);

// ---------------------------------------------------------------- 1. configuração de cada serviço
for (const service of ["api", "web", "worker"] as const) {
  try {
    loadConfig(service);
    add("Configuração", `variáveis do ${service} válidas`, "ok");
  } catch (err) {
    add("Configuração", `variáveis do ${service}`, "erro", err instanceof ConfigError ? err.issues.join("; ") : msg(err), "ambiente.md");
  }
}

// ---------------------------------------------------------------- 2. banco e empresa de teste
const orgName = env.DEMO_ORG_NAME ?? "Empresa de teste (integrações)";
let orgId: string | null = null;
const routes = new Map<string, string>();
const idCount = new Map<string, number>();
if (env.DATABASE_URL) {
  const pool = createPool(env.DATABASE_URL, 2);
  const db = createDb(pool);
  try {
    const [{ n } = { n: 0 }] = await asSystem(db, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int as n from information_schema.tables where table_name = 'deployments'`)).then((r) => r.rows);
    add("Banco", "conexão", "ok");
    add("Banco", "migrações aplicadas", n ? "ok" : "falta", n ? undefined : "rode pnpm db:migrate", "ambiente.md");
    const [org] = await asSystem(db, (tx) => tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.name, orgName)));
    orgId = org?.id ?? null;
    add("Banco", `empresa de teste "${orgName}"`, orgId ? "ok" : "falta", orgId ?? "rode pnpm integracoes:ligar", "README.md");
    if (orgId) {
      for (const r of await db.select().from(installationRoutes).where(eq(installationRoutes.orgId, orgId))) routes.set(r.kind, r.externalId);
      const rows = await withOrg(db, orgId, (tx) =>
        tx
          .select({ platform: identities.platform, n: sql<number>`count(*)::int` })
          .from(identities)
          .innerJoin(people, eq(people.id, identities.personId))
          .where(and(eq(identities.orgId, orgId!), eq(people.active, true)))
          .groupBy(identities.platform),
      );
      for (const r of rows) idCount.set(r.platform, r.n);
      add("Banco", "pessoas com contas ligadas", rows.length ? "ok" : "falta", rows.map((r) => `${r.platform}: ${r.n}`).join(", ") || "preencha DEMO_IDENTITIES e rode pnpm integracoes:ligar", "README.md");
    }
  } catch (err) {
    add("Banco", "conexão", "erro", msg(err), "ambiente.md");
  } finally {
    await pool.end();
  }
} else {
  add("Banco", "DATABASE_URL", "falta", undefined, "ambiente.md");
}

const routeCheck = (area: string, kind: string, envKey: string, fromPlatform?: string, guide?: string) => {
  const configured = env[envKey];
  if (!configured) return add(area, envKey, "falta", fromPlatform ? `a plataforma informa: ${fromPlatform}` : undefined, guide);
  if (fromPlatform && configured !== fromPlatform) return add(area, envKey, "erro", `no .env: ${configured}; a plataforma informa: ${fromPlatform}`, guide);
  if (orgId && routes.get(kind) !== configured) return add(area, `rota ${kind} ligada à empresa`, "falta", "rode pnpm integracoes:ligar", guide);
  add(area, `${envKey} ligado à empresa`, "ok", configured);
};

// ---------------------------------------------------------------- 3. API pelo endereço público
const api = (env.API_PUBLIC_URL ?? "").replace(/\/$/, "");
if (api) {
  try {
    const r = await fetch(`${api}/ready`, { signal: AbortSignal.timeout(8_000) });
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean };
    add("API", `${api}/ready`, r.ok && body.ok ? "ok" : "erro", r.ok ? undefined : `HTTP ${r.status}`, "ambiente.md");
  } catch (err) {
    add("API", `${api}/ready`, "erro", msg(err), "ambiente.md");
  }
} else {
  add("API", "API_PUBLIC_URL (endereço do túnel ou da Render)", "aviso", "sem ele, as plataformas não alcançam a API", "ambiente.md");
}

// ---------------------------------------------------------------- 4. cada plataforma
// Slack
{
  const need = missing("SLACK_SIGNING_SECRET", "SLACK_BOT_TOKEN");
  if (need.length) add("Slack", "segredos", "falta", need.join(", "), "slack.md");
  if (env.SLACK_BOT_TOKEN) {
    try {
      const me = await new SlackChat({ token: env.SLACK_BOT_TOKEN }).authTest();
      add("Slack", "token do bot aceito", "ok", `bot ${me.userId}`);
      routeCheck("Slack", "slack", "DEMO_SLACK_TEAM_ID", me.teamId, "slack.md");
    } catch (err) {
      add("Slack", "token do bot", "erro", msg(err), "slack.md");
    }
  }
  add("Slack", "login no painel (SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SESSION_SECRET, PANEL_URL)", has("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SESSION_SECRET", "PANEL_URL") ? "ok" : "falta", missing("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SESSION_SECRET", "PANEL_URL").join(", ") || undefined, "slack.md");
  add("Slack", "pessoas com conta do Slack", (idCount.get("slack") ?? 0) >= 2 ? "ok" : "falta", `${idCount.get("slack") ?? 0} (o teste precisa de pelo menos duas: quem pergunta e quem é citado)`, "slack.md");
}

// GitHub
{
  if (!env.GITHUB_WEBHOOK_SECRET) add("GitHub", "GITHUB_WEBHOOK_SECRET", "falta", undefined, "github.md");
  if (has("GITHUB_APP_ID", "GITHUB_PRIVATE_KEY")) {
    try {
      const app = new GithubApp({ appId: env.GITHUB_APP_ID!, privateKey: env.GITHUB_PRIVATE_KEY! });
      const { data: installs } = await app.request<{ id: number; account: { login: string } }[]>("/app/installations", async () => app.jwt());
      add("GitHub", "GitHub App aceito", "ok", installs.map((i) => `${i.id} em ${i.account.login}`).join(", ") || "sem instalações");
      const chosen = env.DEMO_GITHUB_INSTALLATION_ID ?? (installs.length === 1 ? String(installs[0]!.id) : undefined);
      routeCheck("GitHub", "github", "DEMO_GITHUB_INSTALLATION_ID", installs.length === 1 ? String(installs[0]!.id) : undefined, "github.md");
      if (chosen) {
        const repos = await app.forInstallation(chosen).listRepositories();
        add("GitHub", "repositórios visíveis pela instalação", repos.length ? "ok" : "falta", repos.join(", ") || "instale o app no repositório de teste", "github.md");
        const brains = env.BRAINS_REPOSITORY;
        if (brains) {
          const seen = repos.some((r) => r.toLowerCase() === brains.toLowerCase());
          add("GitHub", `espelho das notas em ${brains}`, seen ? "ok" : "falta", seen ? undefined : "adicione o repositório brains à instalação do app", "github.md");
        } else {
          add("GitHub", "BRAINS_REPOSITORY (espelho das notas)", "aviso", "opcional: sem ele, as notas não vão para o Obsidian", "github.md");
        }
      }
    } catch (err) {
      add("GitHub", "GitHub App", "erro", msg(err), "github.md");
    }
  } else {
    add("GitHub", "GITHUB_APP_ID e GITHUB_PRIVATE_KEY", "falta", undefined, "github.md");
  }
  add("GitHub", "pessoas com login do GitHub", (idCount.get("github") ?? 0) > 0 ? "ok" : "falta", String(idCount.get("github") ?? 0), "github.md");
}

// Linear
{
  if (!env.LINEAR_WEBHOOK_SECRET) add("Linear", "LINEAR_WEBHOOK_SECRET", "falta", undefined, "linear.md");
  const linear = env.LINEAR_API_KEY ? new LinearTracker({ token: env.LINEAR_API_KEY }) : has("LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET") ? new LinearTracker({ clientId: env.LINEAR_CLIENT_ID!, clientSecret: env.LINEAR_CLIENT_SECRET! }) : null;
  if (linear) {
    try {
      const o = await linear.organization();
      add("Linear", "credencial aceita", "ok", o.name);
      routeCheck("Linear", "linear", "DEMO_LINEAR_ORG_ID", o.id, "linear.md");
    } catch (err) {
      add("Linear", "credencial", "erro", msg(err), "linear.md");
    }
  } else {
    add("Linear", "LINEAR_API_KEY ou LINEAR_CLIENT_ID e LINEAR_CLIENT_SECRET", "falta", undefined, "linear.md");
  }
  add("Linear", "pessoas com conta do Linear", (idCount.get("linear") ?? 0) > 0 ? "ok" : "falta", String(idCount.get("linear") ?? 0), "linear.md");
}

// Anthropic (só o formato: conferir de verdade gasta, e isso é o teste A2)
{
  const key = env.ANTHROPIC_API_KEY;
  add("Anthropic", "ANTHROPIC_API_KEY", key ? (key.startsWith("sk-ant-") ? "ok" : "erro") : "falta", key ? (key.startsWith("sk-ant-") ? "formato ok (a chave é testada no A2, com custo)" : "precisa começar com sk-ant-") : "sem ela, o agente responde só por regra", "anthropic.md");
}

// Aviso de RH
add("Aviso de RH", "ENCRYPTION_KEY", env.ENCRYPTION_KEY && /^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY) ? "ok" : "falta", env.ENCRYPTION_KEY ? "precisa ter 64 caracteres hex" : "openssl rand -hex 32", "rh.md");
add("Aviso de RH", "pessoas com matrícula", (idCount.get("rh") ?? 0) > 0 ? "ok" : "aviso", String(idCount.get("rh") ?? 0), "rh.md");

// Agenda
{
  const p = platformsFromEnv(env);
  for (const [provider, envKey, guide] of [["google", "DEMO_GOOGLE_DOMAIN", "agenda-google.md"], ["microsoft", "DEMO_MICROSOFT_TENANT_ID", "agenda-microsoft.md"]] as const) {
    const configured = provider === "google" ? Boolean(p.google) : Boolean(p.microsoft);
    if (!configured) {
      add("Agenda", `${provider}: credenciais`, "aviso", "opcional", guide);
      continue;
    }
    routeCheck("Agenda", provider, envKey, undefined, guide);
    add("Agenda", `${provider}: pessoas com conta`, (idCount.get(provider) ?? 0) > 0 ? "ok" : "falta", `${idCount.get(provider) ?? 0}; confira uma com pnpm integracoes:agenda <e-mail> ${provider}`, guide);
  }
}

// CI/CD
add("CI/CD", "VERCEL_WEBHOOK_SECRET", env.VERCEL_WEBHOOK_SECRET ? "ok" : "aviso", "opcional (deploys)", "cicd.md");
if (env.VERCEL_WEBHOOK_SECRET) routeCheck("CI/CD", "vercel", "DEMO_VERCEL_TEAM_ID", undefined, "cicd.md");

// ---------------------------------------------------------------- saída
const icon: Record<Status, string> = { ok: "✔", falta: "✘", erro: "✘", aviso: "•" };
let area = "";
for (const i of items) {
  if (i.area !== area) {
    area = i.area;
    console.log(`\n${area}`);
  }
  console.log(`  ${icon[i.status]} ${i.check}${i.detail ? ` — ${i.detail}` : ""}${i.status !== "ok" && i.fix ? `  (docs/integracoes/${i.fix})` : ""}`);
}
const bad = items.filter((i) => i.status === "falta" || i.status === "erro");
const ok = items.filter((i) => i.status === "ok").length;
const optional = items.filter((i) => i.status === "aviso").length;
console.log(`\n${ok} ok · ${bad.length} a fazer · ${optional} opcionais ou avisos. ${bad.length ? "Comece pelo primeiro ✘." : "Pronto para os testes de cada guia."}`);
process.exitCode = bad.some((i) => i.status === "erro") ? 1 : 0;
