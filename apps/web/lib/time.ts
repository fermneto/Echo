/** Hora local "HH:MM" num fuso IANA. Só formatação: quem decide ausência é `isAway` (packages/domain). */
export function localTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** "07/11 18:40" no fuso de quem decidiu. */
export function stamp(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).replace(",", "");
}
