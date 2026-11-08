import { hrOverview, type HrOverview, localDate, recentWeeks } from "@echo/domain";
import { TEAM } from "./team";
import { TEAMS } from "./teams";

/**
 * Visão das equipes sem banco (DATABASE_URL ausente): relatórios sintéticos das personas do mapa, sempre os mesmos
 * para a mesma semana. A semana atual ainda não tem envio, como no banco.
 */

/** Número estável de 0 a n-1 a partir de um texto. */
function pick(key: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  // Mistura final (fmix32): chaves quase iguais não dão números quase iguais.
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) % n;
}

export function demoHrOverview(teamIds: readonly string[], now = new Date()): HrOverview {
  const weeks = recentWeeks(localDate(now, "UTC"));
  const people = TEAM.filter((p) => p.teamId && teamIds.includes(p.teamId));
  const past = weeks.slice(0, -1);
  const reports = people.flatMap((p) =>
    past
      .filter((w) => pick(`${p.id}:${w}:envio`, 10) > 0)
      .map((w) => ({ personId: p.id, week: w, state: "sent", metrics: { deliveries: pick(`${p.id}:${w}:e`, 4), reviews: pick(`${p.id}:${w}:r`, 5), helps: pick(`${p.id}:${w}:a`, 3) } })),
  );
  const twinAnswers = people.flatMap((p) =>
    weeks.flatMap((w, i) => Array.from({ length: pick(`${p.id}:${w}:g`, 3) }, (_, k) => ({ ownerId: p.id, answeredAt: new Date(now.getTime() - (weeks.length - 1 - i) * 7 * 86_400_000 - (k + 1) * 3_600_000) }))),
  );
  const absences = people.flatMap((p) =>
    p.availability.kind === "vacation" ? [{ personId: p.id, kind: "vacation", startsAt: new Date(now.getTime() - 3 * 86_400_000), endsAt: new Date(now.getTime() + 6 * 86_400_000) }] : [],
  );
  return hrOverview({
    teams: TEAMS.filter((t) => teamIds.includes(t.id)),
    people: people.map((p) => ({ id: p.id, teamId: p.teamId, role: p.role, active: p.active, name: p.name, timezone: p.timezone })),
    reports,
    twinAnswers,
    absences,
    weeks,
    now,
  });
}
