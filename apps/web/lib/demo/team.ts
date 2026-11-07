import { live } from "./availability";
import { PERSONAS } from "./personas";
import { LEADERS, TEAM_OF } from "./teams";
import type { Persona } from "./types";
import { WEEK, WORLD } from "./world";

/**
 * A equipe inteira do painel: as 7 personas da demo mais a equipe fictícia espalhada pelo mundo.
 * Login e cenários da demo continuam só com as 7 personas (personas.ts).
 */

const REAL = new Set(["fernando", "eduardo", "yan"]);

const LOCATION: Record<string, [number, number]> = {
  fernando: [-3.73, -38.53],
  eduardo: [-26.2, 28.05],
  rita: [-23.55, -46.63],
  yan: [35.68, 139.65],
  marina: [-23.55, -46.63],
  bruno: [-23.55, -46.63],
  carla: [-23.55, -46.63],
};

const TITLE: Record<string, string> = {
  noah: "Engenheiro de front-end",
  lucia: "Engenheira de back-end",
  ana: "Engenheira de dados",
  ines: "Engenheira de qualidade",
  jonas: "Engenheiro de plataforma",
  amara: "Engenheira de dados",
  omar: "Engenheiro de segurança",
  priya: "Engenheira de back-end",
  wei: "Engenheiro de dados",
  jiwoo: "Engenheira do aplicativo",
  olivia: "Engenheira do aplicativo",
};

const fromWorld: Persona[] = WORLD.map((m) =>
  live({
    id: m.id,
    orgId: "demo",
    name: m.name,
    title: TITLE[m.id] ?? "Engenharia",
    story: "Persona simulada",
    role: LEADERS.has(m.id) ? "leader" : "member",
    teamId: TEAM_OF[m.id],
    city: m.city,
    cityCode: m.cityCode,
    timezone: m.timezone,
    workHours: m.hours ?? WEEK,
    areas: [],
    skills: [],
    active: true,
    availability: m.vacation ? { kind: "vacation", until: "14/11" } : { kind: "working" },
    location: m.location,
    simulated: true,
    hair: m.hair,
  }),
);

export const TEAM: readonly Persona[] = [
  ...PERSONAS.map((p) => live({ ...p, location: LOCATION[p.id], simulated: !REAL.has(p.id) })),
  ...fromWorld,
].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

export function findMember(id: string): Persona | undefined {
  return TEAM.find((p) => p.id === id);
}

/** Contagem de um recorte da equipe (o que a pessoa logada pode ver). */
export function teamCounts(people: readonly Persona[] = TEAM) {
  const on = people.filter((p) => p.availability.kind === "working").length;
  const away = people.length - on;
  const zones = new Set(people.map((p) => p.timezone)).size;
  return { on, away, zones, total: people.length };
}
