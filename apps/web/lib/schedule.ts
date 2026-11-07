import type { Persona } from "./demo/types";

/**
 * Linha do tempo dos fusos: o estado de cada pessoa ao longo do tempo, pelo expediente cadastrado.
 * É só exibição. Quem decide se a pessoa está ausente é `isAway` (packages/domain); quando ele
 * for implementado, este cálculo passa a chamá-lo por segmento.
 */

export type RailState = "on" | "twin" | "wait";

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function localParts(at: Date, timeZone: string): { weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { weekday: WEEKDAY[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm: string) => {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

export function railStateAt(p: Persona, at: Date): RailState {
  if (p.availability.kind === "vacation") return "wait";
  const { weekday, minutes } = localParts(at, p.timezone);
  const working = p.workHours.days.includes(weekday) && minutes >= toMinutes(p.workHours.start) && minutes < toMinutes(p.workHours.end);
  return working ? "on" : "twin";
}

export type Rail = { segments: { state: RailState; past: boolean }[]; nowIndex: number };

/** `hours` horas centradas em `now`, em segmentos de `stepMinutes`. */
export function railFor(p: Persona, now: Date, opts: { hours?: number; stepMinutes?: number } = {}): Rail {
  const hours = opts.hours ?? 24;
  const step = opts.stepMinutes ?? 30;
  const count = (hours * 60) / step;
  const start = now.getTime() - (hours / 2) * 3_600_000;
  const nowIndex = Math.floor(count / 2);
  const segments = Array.from({ length: count }, (_, i) => ({
    state: railStateAt(p, new Date(start + i * step * 60_000)),
    past: i < nowIndex,
  }));
  return { segments, nowIndex };
}
