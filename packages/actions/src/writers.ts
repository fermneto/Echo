// Escritores de cada empresa a partir da configuração.
import { githubForOrg, platformsFromEnv, type ChatPlatform, type CodeWriter, type IssueWriter, type PlatformEnv } from "@echo/connectors";
import type { Database } from "@echo/db";

export type { PlatformEnv };

export function writersFromEnv(db: Database, env: PlatformEnv) {
  const p = platformsFromEnv(env);
  return async (orgId: string): Promise<{ code?: CodeWriter; issues?: IssueWriter; chat?: ChatPlatform }> => {
    const code = await githubForOrg(db, p, orgId);
    // Um tracker por empresa: o Linear quando ligado; senão, o Jira.
    const issues = p.linear ?? p.jira;
    return { ...(code ? { code } : {}), ...(issues ? { issues } : {}), ...(p.chat ? { chat: p.chat } : {}) };
  };
}
