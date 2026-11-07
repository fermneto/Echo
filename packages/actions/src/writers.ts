// Monta os escritores de cada empresa a partir da configuração (um GitHub App, um app do Linear e um bot do Slack).
import { GithubApp, LinearTracker, SlackChat, type ChatPlatform, type CodeWriter, type IssueWriter } from "@echo/connectors";
import { installationRoutes, type Database } from "@echo/db";
import { and, eq } from "drizzle-orm";

export interface PlatformEnv {
  GITHUB_APP_ID?: string | undefined;
  GITHUB_PRIVATE_KEY?: string | undefined;
  LINEAR_CLIENT_ID?: string | undefined;
  LINEAR_CLIENT_SECRET?: string | undefined;
  /** Alternativa para testes: chave pessoal de API do Linear (lin_api_…). */
  LINEAR_API_KEY?: string | undefined;
  SLACK_BOT_TOKEN?: string | undefined;
}

export function writersFromEnv(db: Database, env: PlatformEnv) {
  const github = env.GITHUB_APP_ID && env.GITHUB_PRIVATE_KEY ? new GithubApp({ appId: env.GITHUB_APP_ID, privateKey: env.GITHUB_PRIVATE_KEY }) : undefined;
  const linear = env.LINEAR_API_KEY
    ? new LinearTracker({ token: env.LINEAR_API_KEY })
    : env.LINEAR_CLIENT_ID && env.LINEAR_CLIENT_SECRET
      ? new LinearTracker({ clientId: env.LINEAR_CLIENT_ID, clientSecret: env.LINEAR_CLIENT_SECRET })
      : undefined;
  const chat = env.SLACK_BOT_TOKEN ? new SlackChat({ token: env.SLACK_BOT_TOKEN }) : undefined;

  return async (orgId: string): Promise<{ code?: CodeWriter; issues?: IssueWriter; chat?: ChatPlatform }> => {
    let code: CodeWriter | undefined;
    if (github) {
      // A instalação do GitHub da empresa é a que aponta para ela em installation_routes.
      const [route] = await db
        .select({ externalId: installationRoutes.externalId })
        .from(installationRoutes)
        .where(and(eq(installationRoutes.kind, "github"), eq(installationRoutes.orgId, orgId)));
      if (route) code = github.forInstallation(route.externalId);
    }
    return { ...(code ? { code } : {}), ...(linear ? { issues: linear } : {}), ...(chat ? { chat } : {}) };
  };
}
