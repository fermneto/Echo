import { workingAt } from "../schedule";
import type { Availability, Persona } from "./types";

/**
 * Disponibilidade pelo relógio real: no expediente cadastrado, a pessoa responde; fora dele,
 * o gêmeo cobre até a próxima entrada. Férias são ausência registrada e não dependem da hora.
 * Quando `isAway` (packages/domain) chegar ao painel, este cálculo passa a chamá-lo.
 */

const DAY_NAME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function localDay(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const hourLabel = (hhmm: string) => {
  const [h = "0", m = "00"] = hhmm.split(":");
  return m === "00" ? `${Number(h)}h` : `${Number(h)}h${m}`;
};

/** "hoje às 9h", "amanhã às 8h" ou "segunda às 9h", sempre no horário da cidade da pessoa. */
export function nextStart(p: Pick<Persona, "timezone" | "workHours" | "city">, at: Date): string {
  const { weekday, minutes } = localDay(at, p.timezone);
  const [sh = "0", sm = "0"] = p.workHours.start.split(":");
  const startMin = Number(sh) * 60 + Number(sm);
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = (weekday + ahead) % 7;
    if (!p.workHours.days.includes(day)) continue;
    if (ahead === 0 && minutes >= startMin) continue;
    const when = ahead === 0 ? "hoje" : ahead === 1 ? "amanhã" : DAY_NAME[day];
    return `${when} às ${hourLabel(p.workHours.start)}, horário de ${p.city}`;
  }
  return `no próximo expediente, horário de ${p.city}`;
}

export function availabilityAt(p: Pick<Persona, "timezone" | "workHours" | "city">, vacation: Extract<Availability, { kind: "vacation" }> | null, at: Date): Availability {
  if (vacation) return vacation;
  if (workingAt(p.timezone, p.workHours, at)) return { kind: "working" };
  return { kind: "off", returns: nextStart(p, at) };
}

/**
 * Troca a disponibilidade fixa da persona por uma calculada a cada leitura, pelo relógio.
 * Assim todas as telas e respostas usam a hora real sem mudar quem as consome.
 */
export function live<T extends Persona>(p: T): T {
  const a = p.availability;
  const vacation = a.kind === "vacation" ? a : null;
  Object.defineProperty(p, "availability", { get: () => availabilityAt(p, vacation, new Date()), enumerable: true, configurable: true });
  return p;
}
