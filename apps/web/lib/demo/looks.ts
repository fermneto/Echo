/** Aparência dos bonequinhos da demo. Tons de roupa discretos: verde, azul e âmbar ficam para o estado. */

export type Look = {
  hair: "short" | "long" | "curly" | "bun";
  hairColor: string;
  skin: string;
  shirt: string;
  pants: string;
};

export const LOOKS: Record<string, Look> = {
  fernando: { hair: "short", hairColor: "#2a1d16", skin: "#c68a62", shirt: "#5b4a6e", pants: "#2b2f3a" },
  eduardo: { hair: "curly", hairColor: "#1b1512", skin: "#8a5a3c", shirt: "#6e5a46", pants: "#2a2a2a" },
  yan: { hair: "short", hairColor: "#141414", skin: "#e0b48e", shirt: "#4d5b66", pants: "#262a33" },
  marina: { hair: "long", hairColor: "#3b2618", skin: "#e7bf9b", shirt: "#7a4a52", pants: "#2e2a30" },
  bruno: { hair: "short", hairColor: "#6b4a2f", skin: "#d69f78", shirt: "#55606b", pants: "#2b2b2b" },
  carla: { hair: "bun", hairColor: "#1f1a17", skin: "#a8724f", shirt: "#6b5f4a", pants: "#2c2a35" },
  rita: { hair: "long", hairColor: "#8f7a5a", skin: "#f0caa6", shirt: "#5e5568", pants: "#2a2d30" },
};

export const FALLBACK_LOOK: Look = { hair: "short", hairColor: "#3a3a3a", skin: "#c99a76", shirt: "#4a4a4a", pants: "#2a2a2a" };

export function lookFor(id: string): Look {
  return LOOKS[id] ?? FALLBACK_LOOK;
}
