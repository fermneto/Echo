// Datas no fuso de cada pessoa, só com Intl (embutido no runtime). Nada aqui lê a hora do sistema.

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number;
  hour: number;
  minute: number;
  /** 0 = domingo … 6 = sábado */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Data e hora de um instante no fuso indicado. */
export function zonedParts(at: Date, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? "Sun"] ?? 0,
  };
}

/** AAAA-MM-DD no fuso indicado. */
export function localDate(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Diferença (ms) entre a hora local e UTC naquele instante. Fortaleza: −3 h. */
function offsetAt(at: Date, timeZone: string): number {
  const p = zonedParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(at.getTime() / MINUTE) * MINUTE;
}

/**
 * Instante em que o relógio local marca a data e a hora dadas.
 * Hora repetida (fim do horário de verão): a primeira ocorrência.
 * Hora que não existe (início do horário de verão): o relógio pula para frente, como o relógio da pessoa.
 */
export function zonedTime(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Os dois deslocamentos possíveis perto de uma troca: o de antes e o de depois.
  const before = offsetAt(new Date(wall - 12 * HOUR), timeZone);
  const after = offsetAt(new Date(wall + 12 * HOUR), timeZone);
  const matches = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    return p.year === y && p.month === m && p.day === d && p.hour === hh && p.minute === mm;
  };
  const valid = [wall - before, wall - after].filter(matches).sort((a, b) => a - b);
  return new Date(valid[0] ?? wall - before);
}

/** Soma dias a uma data AAAA-MM-DD (calendário, sem fuso). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Dia da semana (0 = domingo) de uma data AAAA-MM-DD. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Fim do dia AAAA-MM-DD no fuso: o prazo vale até aí (exclusivo). */
export function endOfLocalDay(date: string, timeZone: string): Date {
  return zonedTime(addDays(date, 1), "00:00", timeZone);
}

/** Quantos ms de [from, to) ficam cobertos pelos intervalos (sem contar sobreposição duas vezes). */
export function coveredMs(intervals: { start: Date; end: Date }[], from: Date, to: Date): number {
  const clipped = intervals
    .map((i) => [Math.max(i.start.getTime(), from.getTime()), Math.min(i.end.getTime(), to.getTime())] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [s, e] of clipped) {
    if (s > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = s;
      curEnd = e;
    } else {
      curEnd = Math.max(curEnd, e);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}
