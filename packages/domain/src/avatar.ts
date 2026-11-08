// Bonequinho de cada gêmeo, em pixel art de 16×24 no estilo dos portáteis de 32 bits: contorno escuro,
// cabeça grande, duas tonalidades por cor e luz vinda do alto à esquerda. Sai de traços de lista fechada
// (a foto nunca é guardada) e é composto aqui, por regra, para ficar igual no painel e no Slack.
// Os traços não dizem gênero, idade nem origem: só cabelo, pele, óculos, barba, roupa e chapéu.

export const HAIR_STYLES = ["bald", "buzz", "short", "side", "curly", "afro", "long", "bun"] as const;
export const HAIR_COLORS = ["black", "darkBrown", "brown", "auburn", "blonde", "gray", "white", "teal", "pink"] as const;
export const SKIN_TONES = ["s1", "s2", "s3", "s4", "s5", "s6"] as const;
export const EYEWEAR = ["none", "glasses", "sunglasses"] as const;
export const FACIAL_HAIR = ["none", "stubble", "mustache", "beard"] as const;
export const TOPS = ["tshirt", "hoodie", "shirt", "jacket"] as const;
export const OUTFIT_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "navy", "purple", "black", "white", "gray"] as const;
export const HEADWEAR = ["none", "cap", "beanie"] as const;

export interface AvatarTraits {
  hair: (typeof HAIR_STYLES)[number];
  hairColor: (typeof HAIR_COLORS)[number];
  skin: (typeof SKIN_TONES)[number];
  eyewear: (typeof EYEWEAR)[number];
  facialHair: (typeof FACIAL_HAIR)[number];
  top: (typeof TOPS)[number];
  topColor: (typeof OUTFIT_COLORS)[number];
  headwear: (typeof HEADWEAR)[number];
}

export const AVATAR_LISTS = {
  hair: HAIR_STYLES,
  hairColor: HAIR_COLORS,
  skin: SKIN_TONES,
  eyewear: EYEWEAR,
  facialHair: FACIAL_HAIR,
  top: TOPS,
  topColor: OUTFIT_COLORS,
  headwear: HEADWEAR,
} as const satisfies { [K in keyof AvatarTraits]: readonly AvatarTraits[K][] };

const KEYS = Object.keys(AVATAR_LISTS) as (keyof AvatarTraits)[];

/**
 * Confere a saída do modelo: só valores da lista fechada. Campo fora da lista vira o valor de `fallback`,
 * e qualquer campo a mais é descartado. Devolve também os campos recusados, para o registro da execução.
 */
export function parseAvatarTraits(raw: unknown, fallback: AvatarTraits): { traits: AvatarTraits; rejected: string[] } {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rejected: string[] = [];
  const traits = { ...fallback };
  for (const k of KEYS) {
    const v = src[k];
    if (typeof v === "string" && (AVATAR_LISTS[k] as readonly string[]).includes(v)) (traits as Record<string, string>)[k] = v;
    else rejected.push(k);
  }
  return { traits, rejected };
}

/** Traços estáveis a partir de um texto (o id da pessoa), para quem ainda não tem foto. */
export function traitsFromSeed(seed: string): AvatarTraits {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const pick = <T>(list: readonly T[], salt: number): T => list[(((h ^ salt) >>> 0) % 9973) % list.length]!;
  return {
    hair: pick(HAIR_STYLES.slice(1), 11),
    hairColor: pick(HAIR_COLORS.slice(0, 6), 23),
    skin: pick(SKIN_TONES, 37),
    eyewear: pick(["none", "none", "glasses"] as const, 41),
    facialHair: "none",
    top: pick(TOPS, 53),
    topColor: pick(OUTFIT_COLORS, 67),
    headwear: "none",
  };
}

/** Uma chave curta que muda quando o desenho muda (versão do endereço da imagem no Slack). */
export function avatarKey(t: AvatarTraits): string {
  return `${SPRITE_VERSION}-${KEYS.map((k) => (AVATAR_LISTS[k] as readonly string[]).indexOf(t[k]).toString(36)).join("")}`;
}

// ---------- Paleta

type Ramp = readonly [base: string, shade: string, line: string];

const SKIN: Record<AvatarTraits["skin"], Ramp> = {
  s1: ["#ffe1c8", "#f0b896", "#9a5a44"],
  s2: ["#f8cfa8", "#e0a478", "#8e5236"],
  s3: ["#e2a878", "#c4834f", "#7a4626"],
  s4: ["#c08454", "#9c6236", "#5e341a"],
  s5: ["#8e5a34", "#6e4022", "#3e2210"],
  s6: ["#6a4228", "#4e2e1c", "#24140c"],
};

const HAIR: Record<AvatarTraits["hairColor"], Ramp> = {
  black: ["#383848", "#20202c", "#101018"],
  darkBrown: ["#5a3a2a", "#3e2618", "#20120a"],
  brown: ["#8a5a32", "#64401e", "#34200c"],
  auburn: ["#b04a28", "#80301a", "#40180c"],
  blonde: ["#f0d070", "#c8a040", "#6a5018"],
  gray: ["#a8a8b0", "#808088", "#40404a"],
  white: ["#f0f0f4", "#c8c8d4", "#606070"],
  teal: ["#40c0b0", "#208878", "#0c4038"],
  pink: ["#f088b8", "#c05888", "#602840"],
};

const OUTFIT: Record<AvatarTraits["topColor"], Ramp> = {
  red: ["#e04838", "#a82820", "#501010"],
  orange: ["#f08830", "#c05818", "#602808"],
  yellow: ["#f8d040", "#c8a020", "#685010"],
  green: ["#48b048", "#2c7c30", "#143c18"],
  teal: ["#30b0a8", "#1c7c78", "#0c3c3a"],
  blue: ["#4880e8", "#2c54b0", "#142858"],
  navy: ["#384878", "#24305a", "#10182c"],
  purple: ["#9058d0", "#64389c", "#301848"],
  black: ["#404050", "#282834", "#101018"],
  white: ["#f4f4f8", "#c8c8d8", "#5c5c70"],
  gray: ["#9898a8", "#6c6c7c", "#30303c"],
};

const INK = "#202028";
const EYE = "#202030";
const PANTS: Ramp = ["#405078", "#2c3858", "#141c30"];
const SHOES: Ramp = ["#584038", "#3c2a24", "#1c1210"];
const LENS = "#c8e0f8";
const SHADES_LENS = "#283040";

// ---------- Desenho

export const SPRITE_W = 16;
export const SPRITE_H = 24;
/** Sobe quando o desenho muda, para o Slack buscar a imagem nova. */
export const SPRITE_VERSION = 1;

export interface SpritePixels {
  width: number;
  height: number;
  /** Cor de cada ponto em `#rrggbb`, linha a linha; null é transparente. */
  pixels: (string | null)[];
}

// Cada linha é a metade esquerda (8 pontos), espelhada na direita. Códigos:
// . vazio · o contorno · S pele · e olho · m boca · T roupa · P calça · B sapato · _ mantém o que está embaixo
const BODY = [
  "........",
  "........",
  "........",
  "....oooo",
  "...oSSSS",
  "..oSSSSS",
  "..oSSSSS",
  "..oSSSSS",
  "..oSSeSS",
  "..oSSeSS",
  "..oSSSSS",
  "..oSSSSm",
  "...oSSSS",
  "....oooo",
  "...ooTTT",
  "..oTTTTT",
  ".oTToTTT",
  ".oTToTTT",
  ".oSSoTTT",
  "..oooPPP",
  "....oPPP",
  "....oPPo",
  "...oBBBo",
  "...oooo.",
];

// H cabelo · o contorno (vira o tom escuro do cabelo)
const HAIR_SHAPES: Record<AvatarTraits["hair"], { rows: string[]; from: number }> = {
  bald: { rows: [], from: 0 },
  buzz: { from: 3, rows: ["____oooo", "___oHHHH", "__oHHHHH", "__oH____"] },
  short: { from: 2, rows: ["____oooo", "___oHHHH", "__oHHHHH", "__oHHHHH", "__oHHHHH", "__oHHSHH", "__oH____"] },
  side: { from: 2, rows: ["____oooo", "___oHHHH", "__oHHHHH", "__oHHHHH", "__oHHHHH", "__oHSSSS", "__oH____"] },
  curly: { from: 1, rows: ["___oo_oo", "__oHHoHH", "_oHHHHHH", "_oHHHHHH", "_oHHHHHH", "_oHHHHHH", "_oHHSHSH", "__oH____", "___o____"] },
  afro: { from: 0, rows: ["___ooooo", "__oHHHHH", "_oHHHHHH", "oHHHHHHH", "oHHHHHHH", "oHHHSHHS", "oHH_____", "oHH_____", "oHH_____", "_oH_____", "__o_____"] },
  long: {
    from: 2,
    rows: ["____oooo", "___oHHHH", "__oHHHHH", "__oHHHHH", "_oHHHHHH", "_oHHHSSH", "_oH_____", "_oH_____", "_oH_____", "_oH_____", "_oH_____", "_oH_____", "_oHH____", "__oo____"],
  },
  bun: { from: 0, rows: ["______oo", "_____oHH", "____oooo", "___oHHHH", "__oHHHHH", "__oHHHHH", "__oHHHHH", "__oHHSHH", "__oH____"] },
};

const HEADWEAR_SHAPES: Record<Exclude<AvatarTraits["headwear"], "none">, { rows: string[]; from: number }> = {
  // A aba do boné sai para a esquerda: única peça assimétrica, montada à parte.
  cap: { from: 1, rows: ["____oooo", "___oCCCC", "__oCCCCC", "__oCCCCC", "_oooooCC"] },
  beanie: { from: 1, rows: ["_______o", "____oooo", "___oCCCC", "__oCCCCC", "__oCCCCC", "__occccc"] },
};

const mirror = (half: string) => half + [...half].reverse().join("");

/** Monta a grade de códigos (antes da cor). Exportada para os testes. */
export function spriteCodes(t: AvatarTraits): string[][] {
  const g = BODY.map((r) => [...mirror(r)]);
  const stamp = (shape: { rows: string[]; from: number }, map: Record<string, string>, full = false) => {
    shape.rows.forEach((half, i) => {
      const row = g[shape.from + i];
      if (!row) return;
      const line = full ? half : mirror(half);
      [...line].forEach((c, x) => {
        if (c !== "_") row[x] = map[c] ?? c;
      });
    });
  };

  // O chapéu vem por cima no fim: do cabelo, sobra o que fica abaixo da copa (nada aparece acima dele).
  stamp(HAIR_SHAPES[t.hair], { o: "q" });
  if (t.headwear !== "none") {
    // Acima do chapéu e ao lado da copa, o cabelo some.
    const hw = HEADWEAR_SHAPES[t.headwear];
    for (let r = 0; r < hw.from + hw.rows.length; r++) {
      const half = hw.rows[r - hw.from];
      const edge = half === undefined ? SPRITE_W : half.search(/[^_]/);
      g[r] = g[r]!.map((c, x) => ((c === "H" || c === "q") && (r < hw.from || x < edge || x > SPRITE_W - 1 - edge) ? "." : c));
    }
  }

  if (t.facialHair === "beard") {
    for (const [r, cols] of [[10, [3, 12]], [11, [3, 4, 6, 9, 11, 12]], [12, [4, 5, 6, 9, 10, 11]], [13, [5, 6, 7, 8, 9, 10]]] as const)
      for (const c of cols) g[r]![c] = "H";
  }
  if (t.facialHair === "mustache") for (const c of [6, 7, 8, 9]) g[11]![c] = "H";
  // Barba rala: pontos soltos na cor escura do cabelo, no queixo e nas laterais.
  if (t.facialHair === "stubble") {
    for (const c of [3, 12]) g[11]![c] = "x";
    for (const c of [4, 6, 9, 11]) g[12]![c] = "x";
  }

  if (t.eyewear !== "none") {
    // Aro em cima e ponte; lente clara com o olho à mostra, ou escura cobrindo o olho.
    const lens = t.eyewear === "glasses" ? "L" : "K";
    for (const c of [4, 5, 6, 9, 10, 11]) g[7]![c] = "g";
    g[8]![7] = g[8]![8] = "g";
    for (const r of [8, 9]) for (const c of [4, 5, 6, 9, 10, 11]) g[r]![c] = c === 5 || c === 10 ? (lens === "L" ? "e" : lens) : lens;
  }

  if (t.top === "hoodie") {
    for (const c of [3, 12]) g[13]![c] = "T";
    for (const c of [6, 9]) (g[15]![c] = "w");
  }
  if (t.top === "shirt") {
    g[14]![7] = g[14]![8] = "w";
    g[15]![7] = "w";
  }
  if (t.top === "jacket") for (const r of [14, 15, 16, 17, 18]) (g[r]![7] = "U", (g[r]![8] = "U"));

  if (t.headwear !== "none") {
    const hw = HEADWEAR_SHAPES[t.headwear];
    stamp(hw, {});
    if (t.headwear === "cap") {
      // Aba para a esquerda.
      const brim = g[hw.from + 4]!;
      brim[1] = "o";
      brim[2] = "o";
      for (let x = 9; x < 14; x++) brim[x] = x === 13 ? "o" : "c";
    }
  }
  return g;
}

/** Pinta a grade: cada código vira a cor da sua rampa, com sombra à direita e embaixo (luz do alto à esquerda). */
export function composeSprite(t: AvatarTraits, paint: Partial<{ skin: Ramp; hair: Ramp; top: Ramp; eye: string }> = {}): SpritePixels {
  const g = spriteCodes(t);
  const skin = paint.skin ?? SKIN[t.skin];
  const hair = paint.hair ?? HAIR[t.hairColor];
  const top = paint.top ?? OUTFIT[t.topColor];
  // Em pele escura, o olho fica quase preto, para não sumir.
  const eye = paint.eye ?? (t.skin === "s5" || t.skin === "s6" ? "#0c0a10" : EYE);
  const cap = OUTFIT[t.topColor === "white" ? "navy" : t.topColor === "red" ? "white" : "red"];
  const inner = OUTFIT[t.topColor === "white" || t.topColor === "yellow" ? "navy" : "white"];
  const ramps: Record<string, Ramp> = { S: skin, H: hair, T: top, P: PANTS, B: SHOES, C: cap, w: inner, U: OUTFIT.white };
  const isLine = (c: string | undefined) => c === "o" || c === "q" || c === "g" || c === undefined || c === ".";

  // Cores sem sombra: contorno (o, g), contorno do cabelo (q), olho, boca, barba rala, lentes e aba do boné.
  const flat: Record<string, string> = { o: INK, g: INK, q: hair[2], e: eye, m: skin[1], x: hair[1], L: LENS, K: SHADES_LENS, c: cap[1] };
  const pixels: (string | null)[] = [];
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      const c = g[y]![x]!;
      const ramp = ramps[c];
      if (ramp) {
        // Sombra no último ponto antes do contorno à direita ou embaixo.
        const shaded = (x >= SPRITE_W / 2 && isLine(g[y]![x + 1])) || isLine(g[y + 1]?.[x]);
        pixels.push(shaded ? ramp[1] : ramp[0]);
        continue;
      }
      pixels.push(c === "." ? null : (flat[c] ?? INK));
    }
  }
  return { width: SPRITE_W, height: SPRITE_H, pixels };
}

// ---------- O próprio Echo

const ECHO_TRAITS: AvatarTraits = { hair: "buzz", hairColor: "black", skin: "s1", eyewear: "none", facialHair: "none", top: "tshirt", topColor: "navy", headwear: "none" };

/** O bot Echo: o mesmo corpo, pintado de holograma azul (a cor do gêmeo no comando), com olhos acesos. */
export function composeEchoSprite(): SpritePixels {
  return composeSprite(ECHO_TRAITS, {
    skin: ["#8db4ff", "#4d8dff", "#1f3f90"],
    hair: ["#4d8dff", "#1f5fe0", "#0c2a70"],
    top: ["#1f5fe0", "#16469f", "#0a1f50"],
    eye: "#f4fbff",
  });
}
