/** Prazo em relação a hoje, no fuso de quem lê: "vence hoje", "vence amanhã", "venceu há 2 dias". */
export function dueLabel(dueIso: string, now: Date, timeZone: string): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const diff = Math.round((Date.parse(dueIso) - Date.parse(day(now))) / 86_400_000);
  const date = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(`${dueIso}T12:00:00Z`));
  if (diff === 0) return `vence hoje (${date})`;
  if (diff === 1) return `vence amanhã (${date})`;
  if (diff > 1) return `vence em ${diff} dias (${date})`;
  if (diff === -1) return `venceu ontem (${date})`;
  return `venceu há ${-diff} dias (${date})`;
}

/** Prazo da ECH-128 na história do produto. */
export const ECH_128_DUE = "2026-11-06";
