import { loadConfig } from "@echo/config";
import { orgRoute, SlackChat } from "@echo/connectors";
import type { Database } from "@echo/db";
import type { SlackDirectory, SlackMember } from "./slack-directory";

const TTL_MS = 5 * 60_000;
/** Só a lista lida com sucesso fica em cache; falha e "desligado" são consultados de novo no próximo pedido. */
const cache = new Map<string, { at: number; members: SlackMember[] }>();

/**
 * Membros da workspace do Slack ligada à empresa, para escolher a conta no cadastro e na ficha. "off" quando o
 * painel não tem o token do bot (SLACK_BOT_TOKEN), a empresa não tem Slack ligado ou o token é de outra
 * workspace; "failed" quando o Slack não respondeu (aí a conta é conferida só pelo formato). Só id e nome; nada
 * é gravado. Não chame direto de uma página: passe por `slackDirectoryFor`, que nunca lê na demonstração.
 */
export async function slackDirectory(db: Database, orgId: string): Promise<SlackDirectory> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return { status: "ok", members: hit.members };
  try {
    const members = await load(db, orgId);
    if (!members) return { status: "off" };
    cache.set(orgId, { at: Date.now(), members });
    return { status: "ok", members };
  } catch {
    return { status: "failed" };
  }
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
