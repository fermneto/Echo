import type { Look } from "./looks";
import { PERSONAS } from "./personas";
import { railStateAt, workingAt } from "../schedule";

/**
 * Equipe espalhada pelo mundo para o globo da landing. FICTÍCIA: mostra como seria uma empresa
 * com gente em vários fusos. As 7 personas da demo continuam sendo a base; estas se somam a elas.
 */

export type WorldState = "on" | "twin" | "wait";

export type WorldMember = {
  id: string;
  name: string;
  city: string;
  cityCode: string;
  timezone: string;
  location: [number, number];
  hair: Look["hair"];
  vacation?: boolean;
  /** Escala própria (plantão de fim de semana); sem ela, segunda a sexta, das 9h às 18h. */
  hours?: { days: number[]; start: string; end: string };
};

export const WEEK = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
/** Quem cobre o fim de semana: a equipe não fica inteira apagada no sábado e no domingo. */
const THU_MON = { days: [4, 5, 6, 0, 1], start: "09:00", end: "18:00" };
const WED_SUN_LATE = { days: [3, 4, 5, 6, 0], start: "12:00", end: "21:00" };
const TUE_SAT = { days: [2, 3, 4, 5, 6], start: "11:00", end: "20:00" };

export const WORLD: readonly WorldMember[] = [
  { id: "noah", name: "Noah", city: "Nova York", cityCode: "NYC", timezone: "America/New_York", location: [40.71, -74.0], hair: "square", vacation: true },
  { id: "lucia", name: "Lucía", city: "Cidade do México", cityCode: "MEX", timezone: "America/Mexico_City", location: [19.43, -99.13], hair: "long", hours: THU_MON },
  { id: "ana", name: "Ana", city: "São Paulo", cityCode: "SAO", timezone: "America/Sao_Paulo", location: [-23.55, -46.63], hair: "bun", hours: THU_MON },
  { id: "ines", name: "Inês", city: "Lisboa", cityCode: "LIS", timezone: "Europe/Lisbon", location: [38.72, -9.14], hair: "long", hours: TUE_SAT },
  { id: "jonas", name: "Jonas", city: "Berlim", cityCode: "BER", timezone: "Europe/Berlin", location: [52.52, 13.4], hair: "short", hours: WED_SUN_LATE },
  { id: "amara", name: "Amara", city: "Lagos", cityCode: "LOS", timezone: "Africa/Lagos", location: [6.52, 3.38], hair: "curly" },
  { id: "omar", name: "Omar", city: "Dubai", cityCode: "DXB", timezone: "Asia/Dubai", location: [25.2, 55.27], hair: "short" },
  { id: "priya", name: "Priya", city: "Bangalore", cityCode: "BLR", timezone: "Asia/Kolkata", location: [12.97, 77.59], hair: "long" },
  { id: "wei", name: "Wei", city: "Singapura", cityCode: "SIN", timezone: "Asia/Singapore", location: [1.35, 103.82], hair: "square" },
  { id: "jiwoo", name: "Ji-woo", city: "Seul", cityCode: "SEL", timezone: "Asia/Seoul", location: [37.57, 126.98], hair: "bun" },
  { id: "olivia", name: "Olivia", city: "Sydney", cityCode: "SYD", timezone: "Australia/Sydney", location: [-33.87, 151.21], hair: "curly" },
];

export function worldState(m: WorldMember, at: Date = new Date()): WorldState {
  if (m.vacation) return "wait";
  return workingAt(m.timezone, m.hours ?? WEEK, at) ? "on" : "twin";
}

/** Contagem da equipe inteira (demo + mundo) naquele instante. */
export function worldCounts(at: Date = new Date()) {
  const demo = PERSONAS.map((p) => railStateAt(p, at));
  const all = [...demo, ...WORLD.map((m) => worldState(m, at))];
  return { on: all.filter((s) => s === "on").length, twin: all.filter((s) => s === "twin").length, wait: all.filter((s) => s === "wait").length, total: all.length };
}
