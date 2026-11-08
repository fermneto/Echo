import { avatarKey, parseAvatarTraits, SPRITE_VERSION, traitsFromSeed } from "@echo/domain";

/**
 * Ícone da mensagem no Slack: o bonequinho do gêmeo (ou o do Echo), servido pelo painel. A chave dos traços
 * vai no endereço, para o Slack buscar de novo quando o desenho muda. Sem https público, fica o ícone do app.
 */
export function agentIconUrl(webUrl: string | undefined, orgId: string, owner: { id: string; avatar?: Record<string, string> | null } | undefined): string | undefined {
  if (!webUrl?.startsWith("https://")) return undefined;
  const base = webUrl.replace(/\/$/, "");
  if (!owner) return `${base}/api/avatar/echo?v=${SPRITE_VERSION}`;
  const traits = owner.avatar ? parseAvatarTraits(owner.avatar, traitsFromSeed(owner.id)).traits : traitsFromSeed(owner.id);
  return `${base}/api/avatar/${orgId}/${owner.id}?v=${avatarKey(traits)}`;
}

/**
 * O mesmo ícone para o que sai pelo outbox (`slack.post`): lê os traços gravados da pessoa. Pessoa que não é
 * da empresa sai sem ícone próprio (o do app), nunca com o bonequinho de outra.
 */
export function outboxAgentIcon(webUrl: string | undefined, readAvatar: (orgId: string, personId: string) => Promise<Record<string, string> | null | undefined>) {
  return async (orgId: string, ownerId?: string): Promise<string | undefined> => {
    if (!webUrl?.startsWith("https://")) return undefined;
    if (!ownerId) return agentIconUrl(webUrl, orgId, undefined);
    const avatar = await readAvatar(orgId, ownerId);
    if (avatar === undefined) return undefined;
    return agentIconUrl(webUrl, orgId, { id: ownerId, avatar });
  };
}
