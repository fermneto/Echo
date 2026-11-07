import type { Look } from "@/lib/demo/looks";

/**
 * Bonequinho em matriz de pontos (11×12), de uma cor só: a do estado. Os pontos apagados
 * continuam visíveis bem fracos, mostrando a grade inteira.
 * - "person": no expediente, verde, pisca.
 * - "twin": o gêmeo no comando, azul, com uma varredura de brilho de cima para baixo.
 * - "away": de férias, azul, cabeça esmaecida; o gêmeo cobre.
 * Animação só em CSS (sprites.css).
 */

export type SpriteMode = "person" | "twin" | "away";

const COLS = 11;

/** h = cabeça, e = olho (apagado; acende ao piscar), b = corpo. Proporção da figura: compacta. */
const BASE = [
  "...........",
  "...hhhhh...",
  "..hhhhhhh..",
  "..heeheeh..",
  "..heeheeh..",
  "..hhhhhhh..",
  "...........",
  "bb.bbbbb.bb",
  "bb.bbbbb.bb",
  "...........",
  "...........",
];

function grid(hair: Look["hair"]): string[][] {
  const g = BASE.map((r) => r.split(""));
  const set = (r: number, c: number, v: string) => {
    const row = g[r];
    if (row) row[c] = v;
  };
  if (hair === "long") for (let r = 2; r <= 5; r++) (set(r, 1, "h"), set(r, 9, "h"));
  if (hair === "curly") {
    g[0] = "...h.h.h...".split("");
    g[1] = "..hhhhhhh..".split("");
  }
  if (hair === "bun") g[0] = "....hhh....".split("");
  if (hair === "square") g[1] = "..hhhhhhh..".split("");
  return g;
}

export function PixelSprite({ look, mode, size = 36, label }: { look: Look; mode: SpriteMode; size?: number; label?: string }) {
  const g = grid(look.hair);
  const rows = g.length;
  const dots = g.flatMap((row, y) =>
    row.map((c, x) => {
      const part = c === "h" ? "head" : c === "b" ? "body" : c === "e" ? "eye" : "off";
      return <circle key={`${x}-${y}`} className={`dot-${part}`} cx={x + 0.5} cy={y + 0.5} r={0.34} style={{ ["--row" as string]: y }} />;
    }),
  );
  return (
    <svg
      className={`sprite sprite--${mode}`}
      viewBox={`0 0 ${COLS} ${rows}`}
      width={(size * COLS) / rows}
      height={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {dots}
    </svg>
  );
}
