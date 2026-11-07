/** Formato do topo da cabeça de cada bonequinho da demo. A cor vem sempre do estado. */

export type Look = { hair: "short" | "long" | "curly" | "bun" | "square" };

export const LOOKS: Record<string, Look> = {
  fernando: { hair: "short" },
  eduardo: { hair: "curly" },
  yan: { hair: "square" },
  marina: { hair: "long" },
  bruno: { hair: "short" },
  carla: { hair: "bun" },
  rita: { hair: "long" },
};

export const FALLBACK_LOOK: Look = { hair: "short" };

export function lookFor(id: string): Look {
  return LOOKS[id] ?? FALLBACK_LOOK;
}
