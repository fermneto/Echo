import { loadConfig } from "@echo/config";
import { orgRoute, SlackChat } from "@echo/connectors";
import type { Database } from "@echo/db";

export type SlackMember = { id: string; name: string };

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; members: SlackMember[] | null }>();

/**
 * Membros da workspace do Slack ligada à empresa, para escolher a conta no cadastro e na ficha. Null quando o
 * painel não tem o token do bot (SLACK_BOT_TOKEN), a empresa não tem Slack ligado, o token é de outra workspace
 * ou o Slack não respondeu: aí a tela pede o ID do membro. Só id e nome; nada é gravado.
 */
export async function slackMembers(db: Database, orgId: string): Promise<SlackMember[] | null> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.members;
  const members = await load(db, orgId).catch(() => null);
  cache.set(orgId, { at: Date.now(), members });
  return members;
}

async function load(db: Database, orgId: string): Promise<SlackMember[] | null> {
  const cfg = loadConfig("web");
  if (!cfg.SLACK_BOT_TOKEN) return null;
  const team = await orgRoute(db, orgId, "slack");
  if (!team) return null;
  const chat = new SlackChat({ token: cfg.SLACK_BOT_TOKEN, ...(cfg.SLACK_API_BASE_URL ? { baseUrl: cfg.SLACK_API_BASE_URL } : {}) });
  // O token do painel é de uma workspace só: lista apenas se for a da empresa.
  if ((await chat.authTest()).teamId !== team) return null;
  return (await chat.listUsers()).map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
