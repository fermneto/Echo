import { lookFor } from "@/lib/demo/looks";
import type { Persona } from "@/lib/demo/types";
import { PixelSprite } from "./PixelSprite";

/**
 * Moldura com o bonequinho da pessoa, na cor do estado. Fora do expediente, quem aparece é
 * o gêmeo no comando, em azul; de férias, com a cabeça esmaecida.
 */
export function PixelAvatar({ persona, size = 40 }: { persona: Persona; size?: number }) {
  const state = persona.availability.kind;
  const twin = state !== "working";
  return (
    <span className={`pixel-avatar pixel-avatar--${state}`} style={{ width: size, height: size }} role="img" aria-label={twin ? `Gêmeo de ${persona.name} no comando` : persona.name}>
      <PixelSprite look={lookFor(persona.id)} mode={state === "working" ? "person" : state === "off" ? "twin" : "away"} size={Math.round(size * 0.72)} />
    </span>
  );
}
