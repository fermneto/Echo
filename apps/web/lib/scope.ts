import { cookies } from "next/headers";
import { canSeePerson, visibleTeamIds } from "./access";
import { personIdFor } from "./agent";
import { TEAM } from "./demo/team";
import { TEAMS } from "./demo/teams";
import type { Persona } from "./demo/types";
import { isDemoOrg } from "./gains";
import { loadTeam, loadTeams, type PanelTeam } from "./team-live";

/** Equipes que o RH escolheu acompanhar, por navegador. Sem o cookie, o RH acompanha todas. */
export const FOLLOWED_TEAMS_COOKIE = "echo_equipes_rh";

export function parseFollowed(raw: string | undefined): string[] | null {
  if (raw == null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export type TeamScope = {
  /** Todas as equipes da empresa (o RH escolhe entre elas). */
  teams: readonly PanelTeam[];
  /** Equipes que a pessoa vê agora. */
  visible: string[];
  /** Pessoas do mapa que a pessoa pode ver (ela sempre se vê). */
  people: Persona[];
  /** Só o RH escolhe quais equipes acompanhar. */
  canChoose: boolean;
};

/**
 * Equipes da empresa de quem está logado: as da demonstração para a persona, as do banco para a empresa conectada.
 * `null`: a leitura falhou.
 */
export async function teamsFor(me: Persona): Promise<readonly PanelTeam[] | null> {
  return isDemoOrg(me.orgId) ? TEAMS : loadTeams(me.orgId);
}

/**
 * Recorte a partir da equipe e das equipes já lidas. Pura.
 * - `teams === null` (leitura das equipes falhou): só a própria pessoa, nunca todo mundo.
 * - Empresa sem equipes cadastradas (`[]`): todos se veem, para o painel não ficar vazio (como em visibleTeamIds);
 *   o RH continua sem aparecer para os membros.
 * - Com equipes: membro e liderança, a própria equipe; RH, as escolhidas.
 */
export function scopeFrom(me: Persona, people: readonly Persona[], teams: readonly PanelTeam[] | null, followed: readonly string[] | null): TeamScope {
  if (teams === null) return { teams: [], visible: [], people: people.filter((p) => p.id === me.id), canChoose: false };
  const visible = visibleTeamIds(me, teams.map((t) => t.id), followed);
  const seen = teams.length === 0 ? people.filter((p) => p.id === me.id || me.role === "hr" || p.role !== "hr") : people.filter((p) => canSeePerson(me, p, visible));
  return { teams, visible, people: seen, canChoose: me.role === "hr" && teams.length > 0 };
}

/**
 * O recorte da equipe para a pessoa logada (regra em `scopeFrom`).
 * `team` é a equipe já carregada (por `loadTeam`); sem ela, a da demonstração para a persona e a do banco para
 * quem é de empresa conectada.
 */
export async function teamScope(me: Persona, team?: readonly Persona[]): Promise<TeamScope> {
  const real = !isDemoOrg(me.orgId);
  const [people, teams] = await Promise.all([team ?? (real ? loadTeam(new Date(), { orgId: me.orgId }) : TEAM), teamsFor(me)]);
  const followed = me.role === "hr" ? parseFollowed((await cookies()).get(FOLLOWED_TEAMS_COOKIE)?.value) : null;
  return scopeFrom(me, people, teams, followed);
}

/** Ids no banco de quem está no recorte, para filtrar o que as telas leem do banco. */
export function scopeDbIds(scope: TeamScope): Set<string> {
  return new Set(scope.people.map((p) => personIdFor(p.id)));
}
