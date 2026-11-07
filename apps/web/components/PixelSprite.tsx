import type { Look } from "@/lib/demo/looks";

/**
 * Bonequinho 2D em pixel art, 12×18, em SVG com animação só de CSS (sem JavaScript).
 * - "person": a pessoa no expediente, de pé, respirando e piscando.
 * - "twin": o gêmeo no comando, flutuando sobre uma base de luz.
 */

const BODY = [
  "....hhhh....",
  "...hhhhhh...",
  "..hhhhhhhh..",
  "..hssssssh..",
  "..sseSsess..",
  "..ssssssss..",
  "..sssmmsss..",
  "...ssssss...",
  "....ssss....",
  "..bbbbbbbb..",
  ".bbbbbbbbbb.",
  ".sbbbbbbbbs.",
  "..pppppppp..",
  "..ppp..ppp..",
  "..ppp..ppp..",
  "..ooo..ooo..",
];

function grid(hair: Look["hair"]): string[][] {
  const g = BODY.map((r) => r.replace("S", "s").split(""));
  // Olhos ficam numa camada própria para piscar.
  for (const row of g) for (let i = 0; i < row.length; i++) if (row[i] === "e") row[i] = "s";
  const set = (r: number, c: number, v: string) => {
    const row = g[r];
    if (row) row[c] = v;
  };
  if (hair === "long") for (let r = 3; r <= 8; r++) (set(r, 1, "h"), set(r, 10, "h"));
  if (hair === "curly") {
    g[0] = "...hhhhhh...".split("");
    g[1] = "..hhhhhhhh..".split("");
    g[2] = ".hhhhhhhhhh.".split("");
    for (const r of [3, 4]) (set(r, 1, "h"), set(r, 10, "h"));
  }
  if (hair === "bun") {
    g[0] = ".....hh.....".split("");
    g[1] = "...hhhhhh...".split("");
  }
  return g;
}

const EYES: [number, number][] = [
  [4, 4],
  [7, 4],
];

export function PixelSprite({ look, mode, size = 36, label }: { look: Look; mode: "person" | "twin"; size?: number; label?: string }) {
  const fill: Record<string, string> = { h: look.hairColor, s: look.skin, m: "#6e4330", b: look.shirt, p: look.pants, o: "#141414" };
  const rects = grid(look.hair).flatMap((row, y) => row.map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill[c]} />)));

  return (
    <svg
      className={`sprite sprite--${mode}`}
      viewBox="0 0 12 18"
      width={(size * 12) / 18}
      height={size}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {mode === "twin" && (
        <g className="sprite__pad">
          <rect x="2" y="16" width="8" height="1" fill="#8db4ff" />
          <rect x="3" y="17" width="6" height="1" fill="#4d8dff" />
        </g>
      )}
      <g className="sprite__body">
        {rects}
        <g className="sprite__eyes">
          {EYES.map(([x, y]) => (
            <rect key={x} x={x} y={y} width="1" height="1" fill="#101010" />
          ))}
        </g>
      </g>
    </svg>
  );
}
