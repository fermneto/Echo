import { AVATAR_LISTS, type AvatarTraits } from "@echo/domain";

/**
 * Ajuste do bonequinho na ficha: rótulos em português de cada traço da lista fechada e o estado da tela.
 * Sem dependência de servidor (o componente roda no navegador).
 */

export type BonequinhoState = { status: "idle" } | { status: "error"; error: string } | { status: "saved"; traits: AvatarTraits; note: string };

export const TRAIT_FIELDS: readonly { key: keyof AvatarTraits; label: string }[] = [
  { key: "hair", label: "Cabelo" },
  { key: "hairColor", label: "Cor do cabelo" },
  { key: "skin", label: "Tom de pele" },
  { key: "eyewear", label: "Óculos" },
  { key: "facialHair", label: "Barba" },
  { key: "top", label: "Roupa" },
  { key: "topColor", label: "Cor da roupa" },
  { key: "headwear", label: "Chapéu" },
];

const LABELS: Record<string, string> = {
  bald: "Careca", buzz: "Raspado", short: "Curto", side: "Curto de lado", curly: "Cacheado", afro: "Volumoso", long: "Comprido", bun: "Coque",
  black: "Preto", darkBrown: "Castanho-escuro", brown: "Castanho", auburn: "Ruivo", blonde: "Loiro", gray: "Grisalho", white: "Branco", teal: "Verde-água", pink: "Rosa",
  s1: "1 (mais claro)", s2: "2", s3: "3", s4: "4", s5: "5", s6: "6 (mais escuro)",
  none: "Nenhum", glasses: "De grau", sunglasses: "Escuros",
  stubble: "Rala", mustache: "Bigode", beard: "Cheia",
  tshirt: "Camiseta", hoodie: "Moletom", shirt: "Camisa", jacket: "Jaqueta",
  red: "Vermelho", orange: "Laranja", yellow: "Amarelo", green: "Verde", blue: "Azul", navy: "Azul-marinho", purple: "Roxo",
  cap: "Boné", beanie: "Gorro",
};

/** Opções de um traço, na ordem da lista fechada. "white" e "gray" mudam de rótulo quando é cor de roupa. */
export function traitOptions(key: keyof AvatarTraits): { value: string; label: string }[] {
  return (AVATAR_LISTS[key] as readonly string[]).map((value) => {
    if (key === "topColor" && value === "white") return { value, label: "Branca" };
    if (key === "topColor" && value === "gray") return { value, label: "Cinza" };
    if (key === "facialHair" && value === "none") return { value, label: "Sem barba" };
    return { value, label: LABELS[value] ?? value };
  });
}

/** Os oito campos do formulário, como vieram (a validação contra a lista é `adjustAvatar`). */
export function readTraitsForm(form: FormData): Record<string, string> {
  return Object.fromEntries(TRAIT_FIELDS.map((f) => [f.key, String(form.get(f.key) ?? "")]));
}
