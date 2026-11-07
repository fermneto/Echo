/** Hora local "HH:MM" num fuso IANA. Só formatação: quem decide ausência é `isAway` (packages/domain). */
export function localTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}
