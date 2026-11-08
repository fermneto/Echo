import { type AvatarTraits, traitsFromSeed } from "@echo/domain";

/**
 * Traços do bonequinho de cada pessoa da demo. Na empresa de verdade, saem da foto que o RH envia no
 * cadastro (`people.avatar`); aqui são fixos e sintéticos. Quem não está na lista ganha traços estáveis
 * a partir do id.
 */

export type Look = AvatarTraits;

const t = (hair: Look["hair"], hairColor: Look["hairColor"], skin: Look["skin"], top: Look["top"], topColor: Look["topColor"], extra: Partial<Look> = {}): Look => ({
  hair,
  hairColor,
  skin,
  top,
  topColor,
  eyewear: "none",
  facialHair: "none",
  headwear: "none",
  ...extra,
});

export const LOOKS: Record<string, Look> = {
  fernando: t("short", "black", "s3", "hoodie", "navy", { facialHair: "stubble" }),
  eduardo: t("curly", "darkBrown", "s2", "shirt", "teal", { eyewear: "glasses" }),
  yan: t("side", "black", "s3", "tshirt", "black"),
  marina: t("long", "brown", "s2", "jacket", "purple"),
  bruno: t("buzz", "black", "s5", "tshirt", "green", { facialHair: "beard" }),
  carla: t("bun", "auburn", "s1", "shirt", "orange", { eyewear: "glasses" }),
  rita: t("long", "black", "s4", "hoodie", "red"),
  noah: t("short", "blonde", "s1", "tshirt", "blue", { headwear: "cap" }),
  lucia: t("long", "darkBrown", "s3", "shirt", "yellow"),
  ana: t("bun", "brown", "s3", "tshirt", "teal"),
  ines: t("long", "auburn", "s1", "jacket", "navy"),
  jonas: t("short", "blonde", "s1", "hoodie", "gray", { eyewear: "glasses" }),
  amara: t("afro", "black", "s6", "tshirt", "orange"),
  omar: t("short", "black", "s4", "shirt", "white", { facialHair: "beard" }),
  priya: t("long", "black", "s4", "tshirt", "purple"),
  wei: t("side", "black", "s2", "jacket", "black", { eyewear: "glasses" }),
  jiwoo: t("bun", "pink", "s2", "hoodie", "white"),
  olivia: t("curly", "blonde", "s1", "tshirt", "green", { headwear: "beanie" }),
};

export function lookFor(id: string): Look {
  return LOOKS[id] ?? traitsFromSeed(id);
}
