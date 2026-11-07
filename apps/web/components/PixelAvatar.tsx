import type { Persona } from "@/lib/demo/types";

/**
 * Avatar em pixel art, 10×10, desenhado em SVG. Roupa em cinza; a cor fica no anel de estado.
 * Com a pessoa fora, o gêmeo conduz o avatar: anel azul e losango.
 */

type Look = { hair: "short" | "long" | "curly" | "bun"; hairColor: string; skin: string; shirt: string };

const LOOKS: Record<string, Look> = {
  fernando: { hair: "short", hairColor: "#2a1d16", skin: "#c68a62", shirt: "#3a3a3a" },
  eduardo: { hair: "curly", hairColor: "#1b1512", skin: "#8a5a3c", shirt: "#4a4a4a" },
  yan: { hair: "short", hairColor: "#141414", skin: "#e0b48e", shirt: "#2e2e2e" },
  marina: { hair: "long", hairColor: "#3b2618", skin: "#e7bf9b", shirt: "#565656" },
  bruno: { hair: "short", hairColor: "#6b4a2f", skin: "#d69f78", shirt: "#3f3f3f" },
  carla: { hair: "bun", hairColor: "#1f1a17", skin: "#a8724f", shirt: "#5c5c5c" },
  rita: { hair: "long", hairColor: "#8f7a5a", skin: "#f0caa6", shirt: "#4c4c4c" },
};

const FALLBACK: Look = { hair: "short", hairColor: "#3a3a3a", skin: "#c99a76", shirt: "#3a3a3a" };

const BASE = [
  "...hhhh...",
  "..hhhhhh..",
  "..hssssh..",
  "..sesses..",
  "..ssssss..",
  "..ssmmss..",
  "...ssss...",
  ".bbbbbbbb.",
  "bbbbbbbbbb",
  "bbbbbbbbbb",
];

function sprite(hair: Look["hair"]): string[][] {
  const g = BASE.map((r) => r.split(""));
  const set = (r: number, c: number, v: string) => {
    const row = g[r];
    if (row) row[c] = v;
  };
  if (hair === "long") for (let r = 2; r <= 7; r++) (set(r, 1, "h"), set(r, 8, "h"));
  if (hair === "curly") {
    g[0] = "..hhhhhh..".split("");
    g[1] = ".hhhhhhhh.".split("");
    for (const r of [2, 3]) (set(r, 1, "h"), set(r, 8, "h"));
  }
  if (hair === "bun") {
    g[0] = "....hh....".split("");
    g[1] = "..hhhhhh..".split("");
  }
  return g;
}

export function PixelAvatar({ persona, size = 40 }: { persona: Persona; size?: number }) {
  const look = LOOKS[persona.id] ?? FALLBACK;
  const fill: Record<string, string> = { h: look.hairColor, s: look.skin, e: "#101010", m: "#6e4330", b: look.shirt };
  const state = persona.availability.kind;
  const twin = state !== "working";
  const label = twin ? `Gêmeo de ${persona.name}` : persona.name;

  return (
    <span className={`pixel-avatar pixel-avatar--${state}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox="0 0 10 10" width="100%" height="100%" shapeRendering="crispEdges" aria-hidden="true">
        {sprite(look.hair).flatMap((row, y) =>
          row.map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={fill[c]} />)),
        )}
      </svg>
      {twin && <span className="pixel-avatar__diamond" aria-hidden="true" />}
    </span>
  );
}
