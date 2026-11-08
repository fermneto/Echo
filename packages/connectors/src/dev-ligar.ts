// Liga uma empresa de teste às plataformas reais, para validar as integrações de ponta a ponta.
// Cria (ou atualiza) a empresa, as pessoas, as identidades e as rotas das instalações, e importa
// as tarefas abertas do Linear e os PRs abertos do GitHub pelos adaptadores de leitura.
// Uso: pnpm integracoes:ligar        (variáveis em .env; ver docs/teste-integracoes.md)
import { asSystem, createDb, createPool, identities, installationRoutes, orgs, people, withOrg } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { GithubApp } from "./github-client.ts";
import { ingest } from "./ingest.ts";
import { JiraTracker } from "./jira-client.ts";
import { LinearTracker } from "./linear-client.ts";

interface PessoaTeste {
  nome: string;
  fuso?: string;
  papel?: "member" | "leader" | "hr";
  /** id do Slack (U…) */
  slack?: string;
  /** login do GitHub */
  github?: string;
  /** id do usuário no Linear */
  linear?: string;
  /** accountId da pessoa no Jira Cloud */
  jira?: string;
  /** matrícula no sistema de RH */
  rh?: string;
  /** conta no Google Workspace (e-mail), para a agenda */
  google?: string;
  /** conta no Microsoft 365 (e-mail ou id), para a agenda */
  microsoft?: string;
}

const env = process.env;
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
if (!env.DATABASE_URL) fail("DATABASE_URL ausente no .env.");

let pessoas: PessoaTeste[] = [];
try {
  pessoas = JSON.parse(env.DEMO_IDENTITIES ?? "[]");
} catch {
  fail("DEMO_IDENTITIES não é um JSON válido. Exemplo em docs/teste-integracoes.md.");
}
if (!Array.isArray(pessoas) || pessoas.length === 0) fail("DEMO_IDENTITIES vazio: liste as pessoas do teste com as contas de cada plataforma.");

const pool = createPool(env.DATABASE_URL!, 2, { defaultScope: "system" });
const db = createDb(pool);
const orgName = env.DEMO_ORG_NAME ?? "Empresa de teste (integrações)";

// Achar ou criar a empresa é rotina de sistema (ainda não há empresa na transação).
// Não é empresa de demonstração: `pnpm db:seed` apaga todas as is_demo, e levaria junto as contas ligadas aqui.
const org = await asSystem(db, async (tx) => {
  const [found] = await tx.select().from(orgs).where(eq(orgs.name, orgName));
  if (found?.isDemo) await tx.update(orgs).set({ isDemo: false }).where(eq(orgs.id, found.id));
  return found ?? (await tx.insert(orgs).values({ name: orgName, isDemo: false }).returning())[0]!;
});
const orgId = org.id;
console.log(`Empresa: ${orgName} · ${orgId}`);

// Pessoas e identidades (só as contas informadas; nada é adivinhado).
// Todos trabalham no fim de semana e folgam só na terça (0 = domingo … 6 = sábado), como na demonstração.
const wh = { days: [0, 1, 3, 4, 5, 6], start: "09:00", end: "18:00" };
for (const p of pessoas) await withOrg(db, orgId, async (db) => {
  let [row] = await db.select().from(people).where(and(eq(people.orgId, orgId), eq(people.name, p.nome)));
  if (!row) [row] = await db.insert(people).values({ orgId, name: p.nome, timezone: p.fuso ?? "America/Sao_Paulo", role: p.papel ?? "member", workHours: wh }).returning();
  const accounts = [
    p.slack ? { platform: "slack", externalId: p.slack, login: null } : null,
    p.github ? { platform: "github", externalId: `login:${p.github.toLowerCase()}`, login: p.github } : null,
    p.linear ? { platform: "linear", externalId: p.linear, login: null } : null,
    p.jira ? { platform: "jira", externalId: p.jira, login: null } : null,
    p.rh ? { platform: "rh", externalId: p.rh, login: null } : null,
    p.google ? { platform: "google", externalId: p.google.toLowerCase(), login: null } : null,
    p.microsoft ? { platform: "microsoft", externalId: p.microsoft.toLowerCase(), login: null } : null,
  ].filter((a): a is { platform: string; externalId: string; login: string | null } => a !== null);
  for (const a of accounts) {
    await db
      .insert(identities)
      .values({ orgId, personId: row!.id, ...a })
      .onConflictDoUpdate({ target: [identities.orgId, identities.platform, identities.externalId], set: { personId: row!.id, login: a.login } });
  }
  console.log(`  ${p.nome}: ${accounts.map((a) => a.platform).join(", ") || "sem contas"}`);
});

// Um tracker por vez: com o Linear ligado, vale o Linear. O Jira fica sem rota e sem importação,
// senão as tarefas dos dois se sobrescrevem (ex.: ECH-1 nos dois).
const linearOn = Boolean(env.LINEAR_API_KEY || (env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET));
const jiraOn = !linearOn && Boolean(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN);

// Rotas das instalações: é por elas que um aviso encontra a empresa.
const routes = [
  ["slack", env.DEMO_SLACK_TEAM_ID],
  ["github", env.DEMO_GITHUB_INSTALLATION_ID],
  ["linear", env.DEMO_LINEAR_ORG_ID],
  // Site do Jira em minúsculas (ex.: acme.atlassian.net), como vem no endereço de cada issue.
  ["jira", linearOn ? undefined : env.DEMO_JIRA_SITE?.toLowerCase()],
  ["google", env.DEMO_GOOGLE_DOMAIN],
  ["microsoft", env.DEMO_MICROSOFT_TENANT_ID],
  ["vercel", env.DEMO_VERCEL_TEAM_ID],
] as const;
for (const [kind, externalId] of routes) {
  if (kind === "jira" && linearOn) {
    // Tira uma rota do Jira que tenha ficado de antes: sem ela, o aviso do Jira não chega a esta empresa.
    await db.delete(installationRoutes).where(and(eq(installationRoutes.kind, "jira"), eq(installationRoutes.orgId, orgId)));
    if (env.DEMO_JIRA_SITE) console.log("  rota jira: ignorada, o Linear está ligado (vale o Linear)");
    continue;
  }
  if (!externalId) {
    console.log(`  rota ${kind}: não informada (DEMO_${kind.toUpperCase()}_…)`);
    continue;
  }
  await db.insert(installationRoutes).values({ kind, externalId, orgId }).onConflictDoUpdate({ target: [installationRoutes.kind, installationRoutes.externalId], set: { orgId } });
  console.log(`  rota ${kind}: ${externalId}`);
}

// Importa o estado atual pelos adaptadores de leitura (o mesmo caminho da reconciliação).
if (linearOn) {
  const linear = env.LINEAR_API_KEY ? new LinearTracker({ token: env.LINEAR_API_KEY }) : new LinearTracker({ clientId: env.LINEAR_CLIENT_ID!, clientSecret: env.LINEAR_CLIENT_SECRET! });
  const { tasks, truncated } = await linear.listOpenTasks();
  await ingest(db, orgId, tasks.map((task) => ({ kind: "task_upsert" as const, task })));
  console.log(`Linear: ${tasks.length}${truncated ? "+" : ""} tarefas abertas importadas (${tasks.map((t) => t.key).slice(0, 10).join(", ")})`);
}
if (jiraOn) {
  const jira = new JiraTracker({ baseUrl: env.JIRA_BASE_URL!, email: env.JIRA_EMAIL!, apiToken: env.JIRA_API_TOKEN!, ...(env.JIRA_STORY_POINTS_FIELD ? { storyPointsField: env.JIRA_STORY_POINTS_FIELD } : {}), ...(env.JIRA_JQL ? { jql: env.JIRA_JQL } : {}) });
  const { tasks, truncated } = await jira.listOpenTasks();
  await ingest(db, orgId, tasks.map((task) => ({ kind: "task_upsert" as const, task })));
  console.log(`Jira (${jira.site}): ${tasks.length}${truncated ? "+" : ""} tarefas abertas importadas (${tasks.map((t) => t.key).slice(0, 10).join(", ")})`);
}
if (env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY && env.DEMO_GITHUB_INSTALLATION_ID) {
  const gh = new GithubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY }).forInstallation(env.DEMO_GITHUB_INSTALLATION_ID);
  for (const repo of await gh.listRepositories()) {
    const prs = await gh.listOpenPullRequests(repo);
    await ingest(db, orgId, prs.map((pr) => ({ kind: "pr_upsert" as const, pr })));
    console.log(`GitHub: ${repo} · ${prs.length} PRs abertos importados`);
  }
}
await pool.end();
console.log("Pronto. Próximo passo: pnpm acao:testar (ver docs/teste-integracoes.md).");
