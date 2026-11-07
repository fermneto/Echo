import { live } from "./availability";
import { PERSONAS } from "./personas";
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
  rita: [-26.2, 28.05],
  yan: [35.68, 139.65],
  marina: [35.68, 139.65],
  bruno: [35.68, 139.65],
  carla: [35.68, 139.65],
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
    role: "member",
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

export function teamCounts() {
  const on = TEAM.filter((p) => p.availability.kind === "working").length;
  const away = TEAM.length - on;
  const zones = new Set(TEAM.map((p) => p.timezone)).size;
  return { on, away, zones, total: TEAM.length };
}
