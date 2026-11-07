import { cookies } from "next/headers";
import { canSeePerson, visibleTeamIds } from "./access";
import { TEAM } from "./demo/team";
import { TEAMS, type DemoTeam } from "./demo/teams";
import type { Persona } from "./demo/types";

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
  teams: readonly DemoTeam[];
  /** Equipes que a pessoa vê agora. */
  visible: string[];
  /** Pessoas do mapa que a pessoa pode ver (ela sempre se vê). */
  people: Persona[];
  /** Só o RH escolhe quais equipes acompanhar. */
  canChoose: boolean;
};

/** O recorte da equipe para a pessoa logada: membro e liderança, a própria equipe; RH, as escolhidas. */
export async function teamScope(me: Persona): Promise<TeamScope> {
  const followed = me.role === "hr" ? parseFollowed((await cookies()).get(FOLLOWED_TEAMS_COOKIE)?.value) : null;
  const visible = visibleTeamIds(me, TEAMS.map((t) => t.id), followed);
  return { teams: TEAMS, visible, people: TEAM.filter((p) => canSeePerson(me, p, visible)), canChoose: me.role === "hr" };
}
