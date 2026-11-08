// Clientes das plataformas a partir da configuração: um GitHub App, um app do Linear e um bot do Slack.
import { installationRoutes, type Database } from "@echo/db";
import { and, eq, inArray } from "drizzle-orm";
import { GoogleCalendar, MicrosoftCalendar, type CalendarSource } from "./calendar.ts";
import { GithubApp, type GithubCodeHost } from "./github-client.ts";
import { JiraTracker } from "./jira-client.ts";
import { LinearTracker } from "./linear-client.ts";
import { SlackChat } from "./slack-client.ts";

export interface PlatformEnv {
  GITHUB_APP_ID?: string | undefined;
  GITHUB_PRIVATE_KEY?: string | undefined;
  LINEAR_CLIENT_ID?: string | undefined;
  LINEAR_CLIENT_SECRET?: string | undefined;
  /** Alternativa para testes: chave pessoal de API do Linear (lin_api_…). */
  LINEAR_API_KEY?: string | undefined;
  /** Jira Cloud: site, e-mail e token de API de uma conta de serviço. */
  JIRA_BASE_URL?: string | undefined;
  JIRA_EMAIL?: string | undefined;
  JIRA_API_TOKEN?: string | undefined;
  JIRA_STORY_POINTS_FIELD?: string | undefined;
  /** Filtro JQL dos projetos importados (ex.: project in (ECH)). */
  JIRA_JQL?: string | undefined;
  SLACK_BOT_TOKEN?: string | undefined;
  SLACK_API_BASE_URL?: string | undefined;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string | undefined;
  GOOGLE_SERVICE_ACCOUNT_KEY?: string | undefined;
  MICROSOFT_CLIENT_ID?: string | undefined;
  MICROSOFT_CLIENT_SECRET?: string | undefined;
}

export interface Platforms {
  github?: GithubApp;
  linear?: LinearTracker;
  jira?: JiraTracker;
  chat?: SlackChat;
  google?: GoogleCalendar;
  /** Microsoft 365 é por tenant: cada empresa tem o seu (installation_routes kind "microsoft"). */
  microsoft?: (tenantId: string) => MicrosoftCalendar;
}

/** Tracker de tarefas de uma empresa. Vale um por vez. */
export type TrackerKind = "linear" | "jira";

/** Variáveis que decidem o tracker. */
export type TrackerEnv = Pick<PlatformEnv, "LINEAR_API_KEY" | "LINEAR_CLIENT_ID" | "LINEAR_CLIENT_SECRET" | "JIRA_BASE_URL" | "JIRA_EMAIL" | "JIRA_API_TOKEN">;

/** O Linear está configurado: chave pessoal de API ou app OAuth completo. */
export function linearConfigured(env: TrackerEnv): boolean {
  return Boolean(env.LINEAR_API_KEY || (env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET));
}

/**
 * Um tracker por vez: com o Linear configurado, vale o Linear, e o Jira fica de fora (rota, importação,
 * reconciliação, aviso e escrita), senão as tarefas de mesma chave dos dois (ex.: ECH-1) se sobrescrevem.
 * Sem o Linear, vale o Jira se estiver completo. Sem nenhum, `null`.
 */
export function activeTracker(env: TrackerEnv): TrackerKind | null {
  if (linearConfigured(env)) return "linear";
  return env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN ? "jira" : null;
}

/**
 * Tracker da empresa pelas rotas das instalações, para quem não tem as credenciais (a API dos webhooks).
 * Com as duas rotas (ligadas antes da regra), vale o Linear, como em `activeTracker`.
 */
export async function orgActiveTracker(db: Pick<Database, "select">, orgId: string): Promise<TrackerKind | null> {
  const rows = await db
    .select({ kind: installationRoutes.kind })
    .from(installationRoutes)
    .where(and(eq(installationRoutes.orgId, orgId), inArray(installationRoutes.kind, ["linear", "jira"])));
  const kinds = new Set(rows.map((r) => r.kind));
  return kinds.has("linear") ? "linear" : kinds.has("jira") ? "jira" : null;
}

/** Tira da empresa a rota do tracker que não vale (com o Linear, a do Jira). Devolve quantas tirou. */
export async function dropInactiveTrackerRoute(db: Pick<Database, "delete">, orgId: string, active: TrackerKind | null): Promise<number> {
  if (active !== "linear") return 0;
  const gone = await db
    .delete(installationRoutes)
    .where(and(eq(installationRoutes.kind, "jira"), eq(installationRoutes.orgId, orgId)))
    .returning({ externalId: installationRoutes.externalId });
  return gone.length;
}

/**
 * Plataforma dona do id de uma tarefa (`tasks.linear_id`). O id do Jira é só número (ex.: 10042); o do Linear
 * nunca é (UUID). A tabela `tasks` não guarda a origem, e a chave (PROJ-123) é igual nos dois: é por aqui que a
 * escrita recusa mandar ao Linear o id de uma tarefa que ficou do Jira, e vice-versa.
 */
export function trackerOfTaskId(id: string): TrackerKind {
  return /^\d+$/.test(id) ? "jira" : "linear";
}

export function platformsFromEnv(env: PlatformEnv): Platforms {
  const github = env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY ? new GithubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY }) : undefined;
  // Um tracker por vez (activeTracker): com o Linear configurado, o Jira fica de fora (leitura, reconciliação e escrita).
  const tracker = activeTracker(env);
  const linear =
    tracker !== "linear"
      ? undefined
      : env.LINEAR_API_KEY
        ? new LinearTracker({ token: env.LINEAR_API_KEY })
        : new LinearTracker({ clientId: env.LINEAR_CLIENT_ID!, clientSecret: env.LINEAR_CLIENT_SECRET! });
  const jira =
    tracker === "jira"
      ? new JiraTracker({
          baseUrl: env.JIRA_BASE_URL!,
          email: env.JIRA_EMAIL!,
          apiToken: env.JIRA_API_TOKEN!,
          ...(env.JIRA_STORY_POINTS_FIELD ? { storyPointsField: env.JIRA_STORY_POINTS_FIELD } : {}),
          ...(env.JIRA_JQL ? { jql: env.JIRA_JQL } : {}),
        })
      : undefined;
  const chat = env.SLACK_BOT_TOKEN ? new SlackChat({ token: env.SLACK_BOT_TOKEN, ...(env.SLACK_API_BASE_URL ? { baseUrl: env.SLACK_API_BASE_URL } : {}) }) : undefined;
  const google =
    env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_KEY ? new GoogleCalendar({ clientEmail: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey: env.GOOGLE_SERVICE_ACCOUNT_KEY }) : undefined;
  const ms = env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET ? { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET } : undefined;
  const tenants = new Map<string, MicrosoftCalendar>();
  const microsoft = ms
    ? (tenantId: string) => tenants.get(tenantId) ?? tenants.set(tenantId, new MicrosoftCalendar({ tenantId, ...ms })).get(tenantId)!
    : undefined;
  return { ...(github ? { github } : {}), ...(linear ? { linear } : {}), ...(jira ? { jira } : {}), ...(chat ? { chat } : {}), ...(google ? { google } : {}), ...(microsoft ? { microsoft } : {}) };
}

/** Rota de uma plataforma para a empresa (instalação do GitHub, organização do Linear, espaço do Slack). */
export async function orgRoute(db: Database, orgId: string, kind: "github" | "linear" | "jira" | "slack" | "google" | "microsoft" | "vercel"): Promise<string | null> {
  const [r] = await db
    .select({ externalId: installationRoutes.externalId })
    .from(installationRoutes)
    .where(and(eq(installationRoutes.kind, kind), eq(installationRoutes.orgId, orgId)));
  return r?.externalId ?? null;
}

/** Empresas com alguma plataforma ligada. */
export async function connectedOrgs(db: Database): Promise<{ orgId: string; kinds: string[] }[]> {
  const rows = await db.select({ orgId: installationRoutes.orgId, kind: installationRoutes.kind }).from(installationRoutes);
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.orgId, [...(by.get(r.orgId) ?? []), r.kind]);
  return [...by].map(([orgId, kinds]) => ({ orgId, kinds }));
}

/** Agendas ligadas na empresa: Google (pelo domínio) e Microsoft 365 (pelo tenant). */
export async function calendarsForOrg(db: Database, p: Platforms, orgId: string): Promise<CalendarSource[]> {
  const out: CalendarSource[] = [];
  if (p.google && (await orgRoute(db, orgId, "google"))) out.push(p.google);
  const tenant = p.microsoft ? await orgRoute(db, orgId, "microsoft") : null;
  if (tenant && p.microsoft) out.push(p.microsoft(tenant));
  return out;
}

/** GitHub da empresa: a instalação que aponta para ela. */
export async function githubForOrg(db: Database, p: Platforms, orgId: string): Promise<GithubCodeHost | undefined> {
  if (!p.github) return undefined;
  const installation = await orgRoute(db, orgId, "github");
  return installation ? p.github.forInstallation(installation) : undefined;
}
