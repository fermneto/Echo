import { PERSONAS } from "./personas";
import { WORK_DAYS } from "./teams";
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
  vacation?: boolean;
  /** Horário próprio; sem ele, das 9h às 18h. Todos folgam só na terça. */
  hours?: { days: number[]; start: string; end: string };
};

export const WEEK = { days: WORK_DAYS, start: "09:00", end: "18:00" };
// Mesmos horários de antes; os dias agora são de quarta a segunda para todos (igual ao seed).
const NOON_TO_9PM = { days: WORK_DAYS, start: "12:00", end: "21:00" };
const ELEVEN_TO_8PM = { days: WORK_DAYS, start: "11:00", end: "20:00" };

export const WORLD: readonly WorldMember[] = [
  { id: "noah", name: "Noah", city: "Nova York", cityCode: "NYC", timezone: "America/New_York", location: [40.71, -74.0], vacation: true },
  { id: "lucia", name: "Lucía", city: "Cidade do México", cityCode: "MEX", timezone: "America/Mexico_City", location: [19.43, -99.13] },
  { id: "ana", name: "Ana", city: "São Paulo", cityCode: "SAO", timezone: "America/Sao_Paulo", location: [-23.55, -46.63] },
  { id: "ines", name: "Inês", city: "Lisboa", cityCode: "LIS", timezone: "Europe/Lisbon", location: [38.72, -9.14], hours: ELEVEN_TO_8PM },
  { id: "jonas", name: "Jonas", city: "Berlim", cityCode: "BER", timezone: "Europe/Berlin", location: [52.52, 13.4], hours: NOON_TO_9PM },
  { id: "amara", name: "Amara", city: "Lagos", cityCode: "LOS", timezone: "Africa/Lagos", location: [6.52, 3.38] },
  { id: "omar", name: "Omar", city: "Dubai", cityCode: "DXB", timezone: "Asia/Dubai", location: [25.2, 55.27] },
  { id: "priya", name: "Priya", city: "Bangalore", cityCode: "BLR", timezone: "Asia/Kolkata", location: [12.97, 77.59] },
  { id: "wei", name: "Wei", city: "Singapura", cityCode: "SIN", timezone: "Asia/Singapore", location: [1.35, 103.82] },
  { id: "jiwoo", name: "Ji-woo", city: "Seul", cityCode: "SEL", timezone: "Asia/Seoul", location: [37.57, 126.98] },
  { id: "olivia", name: "Olivia", city: "Sydney", cityCode: "SYD", timezone: "Australia/Sydney", location: [-33.87, 151.21] },
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
