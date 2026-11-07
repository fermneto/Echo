import type { Absence, Person } from "@echo/domain";
import { isAway, localDate, weekdayOf, zonedParts } from "@echo/domain";
import { personIdFor } from "./agent";
import { panelDb } from "./db";
import { DEMO_ORG_ID } from "./gains";
import { TEAM } from "./demo/team";
import type { Availability, Persona } from "./demo/types";

/**
 * Equipe com a disponibilidade do banco: expediente e fuso de `people`, ausências de `absences`, decididos por
 * `isAway` (packages/domain), a mesma regra que o agente usa ao responder. Só as 7 personas da demonstração têm
 * linha no seed; a equipe fictícia do mapa continua como em demo/team.ts. Sem banco, devolve TEAM sem mudança.
 */

const DAY_NAME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Cidade de exibição quando o fuso do banco não é o da persona. */
const CITY_BY_ZONE: Record<string, { city: string; cityCode: string; location: [number, number] }> = {
  "America/Fortaleza": { city: "Fortaleza", cityCode: "FOR", location: [-3.73, -38.53] },
  "America/Sao_Paulo": { city: "São Paulo", cityCode: "SAO", location: [-23.55, -46.63] },
  "Africa/Johannesburg": { city: "Joanesburgo", cityCode: "JNB", location: [-26.2, 28.05] },
  "Asia/Tokyo": { city: "Tóquio", cityCode: "TYO", location: [35.68, 139.65] },
};

const hourLabel = (h: number, m: number) => (m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`);

/** "hoje às 9h", "amanhã às 14h30", "segunda às 9h" ou "16/11 às 9h", no fuso da pessoa. */
export function whenLabel(at: Date, now: Date, timeZone: string): string {
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const p = zonedParts(at, timeZone);
  const when = diff === 0 ? "hoje" : diff === 1 ? "amanhã" : diff > 1 && diff < 7 ? DAY_NAME[weekdayOf(day)] : `${day.slice(8, 10)}/${day.slice(5, 7)}`;
  return `${when} às ${hourLabel(p.hour, p.minute)}`;
}

/** Último dia da ausência, "dd/mm", no fuso da pessoa (a ausência termina no instante `endsAt`, exclusivo). */
function lastDay(endsAt: Date, timeZone: string): string {
  const d = localDate(new Date(endsAt.getTime() - 1), timeZone);
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

/** Disponibilidade de exibição a partir de `isAway`. Férias e licença viram "de férias até"; o resto, "fora, volta". */
export function availabilityFrom(person: Person, absences: Absence[], now: Date, city: string): Availability {
  const r = isAway(person, absences, now);
  if (!r.away) return { kind: "working" };
  if (r.reason === "absence") {
    const a = absences.find((x) => x.personId === person.id && x.startsAt.getTime() <= now.getTime() && now.getTime() < x.endsAt.getTime());
    if (a && (a.kind === "vacation" || a.kind === "leave")) return { kind: "vacation", until: lastDay(a.endsAt, person.timezone) };
  }
  return { kind: "off", returns: r.returnsAt ? `${whenLabel(r.returnsAt, now, person.timezone)}, horário de ${city}` : `no próximo expediente, horário de ${city}` };
}

/** Troca expediente, fuso e disponibilidade das personas que têm linha no banco. Pura. */
export function withLiveAvailability(team: readonly Persona[], people: Person[], absences: Absence[], now: Date): Persona[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  return team.map((p) => {
    const row = byId.get(personIdFor(p.id));
    if (!row) return p;
    const place = row.timezone === p.timezone ? null : CITY_BY_ZONE[row.timezone];
    const city = place?.city ?? p.city;
    // Cópia simples: o getter de `live()` vira valor e é substituído pelo do banco.
    const { availability: _demo, ...rest } = p;
    return {
      ...rest,
      ...(place ?? {}),
      timezone: row.timezone,
      workHours: row.workHours,
      availability: availabilityFrom(row, absences, now, city),
    };
  });
}

type Reader = (orgId: string) => Promise<{ people: Person[]; absences: Absence[] }>;

async function readFromDb(orgId: string): Promise<{ people: Person[]; absences: Absence[] }> {
  const db = panelDb();
  if (!db) throw new Error("sem banco");
  const { createPgAgentData } = await import("@echo/agents/server");
  const data = createPgAgentData(db, orgId);
  const [people, absences] = await Promise.all([data.people(), data.absences()]);
  return { people, absences };
}

/**
 * Equipe para as telas de pessoas (Início, Pessoas, ficha). Com banco, a disponibilidade sai de `isAway`;
 * sem banco ou com falha na leitura, a equipe da demonstração.
 */
export async function loadTeam(now: Date, deps: { hasDb?: boolean; read?: Reader } = {}): Promise<readonly Persona[]> {
  const hasDb = deps.hasDb ?? panelDb() !== null;
  if (!hasDb) return TEAM;
  try {
    const { people, absences } = await (deps.read ?? readFromDb)(DEMO_ORG_ID);
    return withLiveAvailability(TEAM, people, absences, now);
  } catch (err) {
    console.error("disponibilidade do banco indisponível", err instanceof Error ? err.message : String(err));
    return TEAM;
  }
}

/** Contagem do topo do Início sobre a equipe já carregada. */
export function countsOf(team: readonly Persona[]) {
  const on = team.filter((p) => p.availability.kind === "working").length;
  return { on, away: team.length - on, zones: new Set(team.map((p) => p.timezone)).size, total: team.length };
}
