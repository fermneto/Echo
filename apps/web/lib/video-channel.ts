import type { Role } from "./demo/types";

/** Alvo do canal do vídeo: a empresa (reserva) ou uma equipe. */
export const ORG_TARGET = "empresa";

export type VideoChannelRow = { target: string; label: string; hint: string; channel: string | null };

/**
 * Canais do vídeo da semana que a pessoa pode mudar em /configuracao. Regra pura.
 * - RH: o de reserva da empresa e o de todas as equipes.
 * - Liderança: o da própria equipe; o da empresa só quando ela não tem equipe ou a empresa não tem equipes.
 * - Membro: nenhum.
 */
export function editableVideoChannels(me: { role: Role; teamId?: string | undefined }, view: { org: string | null; teams: readonly { id: string; name: string; channel: string | null }[] }): VideoChannelRow[] {
  if (me.role === "member") return [];
  const org: VideoChannelRow = { target: ORG_TARGET, label: "Empresa (reserva)", hint: view.teams.length ? "Vale para a equipe sem canal." : "A empresa não tem equipes cadastradas: o vídeo sai aqui.", channel: view.org };
  const teams = view.teams.map((t): VideoChannelRow => ({ target: t.id, label: t.name, hint: "Canal da equipe.", channel: t.channel }));
  if (me.role === "hr") return [...teams, org];
  const own = teams.filter((t) => t.target === me.teamId);
  return own.length && view.teams.length ? own : [...own, org];
}

/** Quem pode gravar o alvo pedido (a mesma regra da tela, conferida de novo no servidor). */
export function canEditVideoChannel(me: { role: Role; teamId?: string | undefined }, view: { org: string | null; teams: readonly { id: string; name: string; channel: string | null }[] }, target: string): boolean {
  return editableVideoChannels(me, view).some((r) => r.target === target);
}
