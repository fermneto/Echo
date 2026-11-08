import { composeSprite, SPRITE_H, SPRITE_W, spriteCodes } from "@echo/domain";
import type { Look } from "@/lib/demo/looks";

/**
 * Bonequinho em pixel art (16×24), composto dos traços da pessoa: o mesmo desenho que vai como ícone
 * do agente no Slack. O estado aparece por cima, sem trocar o desenho:
 * - "person": no expediente, cores cheias; pisca.
 * - "twin": o gêmeo no comando, com linhas de holograma azuis descendo.
 * - "away": de férias, o mesmo holograma em âmbar; o gêmeo cobre.
 * Animação só em CSS (sprites.css).
 */

export type SpriteMode = "person" | "twin" | "away";

/** Pontos iguais e vizinhos na mesma linha viram um retângulo só. */
function runs(look: Look) {
  const { pixels } = composeSprite(look);
  const codes = spriteCodes(look);
  const out: { x: number; y: number; w: number; fill: string; eye: boolean }[] = [];
  for (let y = 0; y < SPRITE_H; y++) {
    let x = 0;
    while (x < SPRITE_W) {
      const fill = pixels[y * SPRITE_W + x];
      const eye = codes[y]![x] === "e";
      let w = 1;
      while (x + w < SPRITE_W && pixels[y * SPRITE_W + x + w] === fill && (codes[y]![x + w] === "e") === eye) w++;
      if (fill) out.push({ x, y, w, fill, eye });
      x += w;
    }
  }
  return out;
}

export function PixelSprite({ look, mode, size = 36, label, view = "full" }: { look: Look; mode: SpriteMode; size?: number; label?: string; view?: "full" | "bust" }) {
  const rows = view === "bust" ? 17 : SPRITE_H;
  return (
    <svg
      className={`sprite sprite--${mode}`}
      viewBox={`0 0 ${SPRITE_W} ${rows}`}
      width={(size * SPRITE_W) / rows}
      height={size}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {runs(look)
        .filter((r) => r.y < rows)
        .map((r) => (
          <rect key={`${r.x}-${r.y}`} className={r.eye ? "px-eye" : undefined} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
        ))}
      {mode !== "person" ? <rect className="sprite__holo" x={0} y={-2} width={SPRITE_W} height={2} /> : null}
    </svg>
  );
}
