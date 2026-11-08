// Escritores de cada empresa a partir da configuração.
import { githubForOrg, platformsFromEnv, type ChatPlatform, type CodeWriter, type IssueWriter, type PlatformEnv } from "@echo/connectors";
import type { Database } from "@echo/db";

export type { PlatformEnv };

export function writersFromEnv(db: Database, env: PlatformEnv) {
  const p = platformsFromEnv(env);
  return async (orgId: string): Promise<{ code?: CodeWriter; linear?: IssueWriter; jira?: IssueWriter; chat?: ChatPlatform }> => {
    const code = await githubForOrg(db, p, orgId);
    // Linear e Jira podem estar ligados juntos; o executor escolhe pelo tracker de onde a tarefa veio.
    return { ...(code ? { code } : {}), ...(p.linear ? { linear: p.linear } : {}), ...(p.jira ? { jira: p.jira } : {}), ...(p.chat ? { chat: p.chat } : {}) };
  };
}
