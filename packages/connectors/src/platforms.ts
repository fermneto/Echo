// Clientes das plataformas a partir da configuração: um GitHub App, um app do Linear e um bot do Slack.
import { installationRoutes, type Database } from "@echo/db";
import { and, eq } from "drizzle-orm";
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

export function platformsFromEnv(env: PlatformEnv): Platforms {
  const github = env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY ? new GithubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY }) : undefined;
  const linear = env.LINEAR_API_KEY
    ? new LinearTracker({ token: env.LINEAR_API_KEY })
    : env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET
      ? new LinearTracker({ clientId: env.LINEAR_CLIENT_ID, clientSecret: env.LINEAR_CLIENT_SECRET })
      : undefined;
  const jira =
    env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN
      ? new JiraTracker({
          baseUrl: env.JIRA_BASE_URL,
          email: env.JIRA_EMAIL,
          apiToken: env.JIRA_API_TOKEN,
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
