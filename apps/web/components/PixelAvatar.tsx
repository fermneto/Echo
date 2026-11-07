import { lookFor } from "@/lib/demo/looks";
import type { Persona } from "@/lib/demo/types";
import { PixelSprite } from "./PixelSprite";

/**
 * Moldura com o bonequinho da pessoa. Fora do expediente, quem aparece é o gêmeo no comando:
 * flutuando sobre a base de luz, com moldura azul e losango.
 */
export function PixelAvatar({ persona, size = 40 }: { persona: Persona; size?: number }) {
  const state = persona.availability.kind;
  const twin = state !== "working";
  return (
    <span className={`pixel-avatar pixel-avatar--${state}`} style={{ width: size, height: size }} role="img" aria-label={twin ? `Gêmeo de ${persona.name} no comando` : persona.name}>
      <PixelSprite look={lookFor(persona.id)} mode={twin ? "twin" : "person"} size={Math.round(size * 0.86)} />
      {twin && <span className="pixel-avatar__diamond" aria-hidden="true" />}
    </span>
  );
}
