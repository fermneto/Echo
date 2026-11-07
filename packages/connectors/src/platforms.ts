// Clientes das plataformas a partir da configuração: um GitHub App, um app do Linear e um bot do Slack.
import { installationRoutes, type Database } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { GithubApp, type GithubCodeHost } from "./github-client.ts";
import { LinearTracker } from "./linear-client.ts";
import { SlackChat } from "./slack-client.ts";

export interface PlatformEnv {
  GITHUB_APP_ID?: string | undefined;
  GITHUB_PRIVATE_KEY?: string | undefined;
  LINEAR_CLIENT_ID?: string | undefined;
  LINEAR_CLIENT_SECRET?: string | undefined;
  /** Alternativa para testes: chave pessoal de API do Linear (lin_api_…). */
  LINEAR_API_KEY?: string | undefined;
  SLACK_BOT_TOKEN?: string | undefined;
}

export interface Platforms {
  github?: GithubApp;
  linear?: LinearTracker;
  chat?: SlackChat;
}

export function platformsFromEnv(env: PlatformEnv): Platforms {
  const github = env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY ? new GithubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY }) : undefined;
  const linear = env.LINEAR_API_KEY
    ? new LinearTracker({ token: env.LINEAR_API_KEY })
    : env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET
      ? new LinearTracker({ clientId: env.LINEAR_CLIENT_ID, clientSecret: env.LINEAR_CLIENT_SECRET })
      : undefined;
  const chat = env.SLACK_BOT_TOKEN ? new SlackChat({ token: env.SLACK_BOT_TOKEN }) : undefined;
  return { ...(github ? { github } : {}), ...(linear ? { linear } : {}), ...(chat ? { chat } : {}) };
}

/** Rota de uma plataforma para a empresa (instalação do GitHub, organização do Linear, espaço do Slack). */
export async function orgRoute(db: Database, orgId: string, kind: "github" | "linear" | "slack"): Promise<string | null> {
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

/** GitHub da empresa: a instalação que aponta para ela. */
export async function githubForOrg(db: Database, p: Platforms, orgId: string): Promise<GithubCodeHost | undefined> {
  if (!p.github) return undefined;
  const installation = await orgRoute(db, orgId, "github");
  return installation ? p.github.forInstallation(installation) : undefined;
}
