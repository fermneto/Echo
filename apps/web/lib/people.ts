import type { Persona } from "./demo/types";

/** Tom do estado: verde no expediente, azul com o gêmeo cobrindo, âmbar de férias. */
export const toneOf = (p: Persona): "on" | "twin" | "wait" => (p.availability.kind === "working" ? "on" : p.availability.kind === "off" ? "twin" : "wait");

export function statusLine(p: Persona): string {
  const a = p.availability;
  if (a.kind === "working") return "No expediente";
  if (a.kind === "vacation") return `De férias até ${a.until}`;
  return `Fora, volta ${a.returns.replace(/, horário de .*/, "")}`;
}

export function holderLine(p: Persona): string {
  const a = p.availability;
  if (a.kind === "working") return `${p.name} está no expediente e responde por si.`;
  if (a.kind === "vacation") return `Agente de ${p.name} responde pelo que ficou registrado. Ninguém chama quem está de férias.`;
  return `Agente de ${p.name} responde pelo que ficou registrado até a volta.`;
}
