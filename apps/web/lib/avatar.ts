import { type AvatarTraits, composeEchoSprite, composeSprite, parseAvatarTraits, traitsFromSeed } from "@echo/domain";
import { spritePng } from "./sprite-png";

/**
 * Imagem do bonequinho de cada gêmeo, pública (o Slack busca `icon_url` sem login). Só pixel art: nenhum
 * dado pessoal sai daqui, e o endereço leva o id da pessoa, que não é adivinhável.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BACKGROUND = "#0b0e14";

export type AvatarReader = (orgId: string, personId: string) => Promise<Record<string, string> | null | undefined>;

/** PNG do busto da pessoa. 404 para id inválido ou pessoa que não existe na empresa. */
export async function avatarResponse(orgId: string, personId: string, read: AvatarReader, versioned: boolean): Promise<Response> {
  if (!UUID.test(orgId) || !UUID.test(personId)) return new Response("não encontrado", { status: 404 });
  const raw = await read(orgId, personId);
  if (raw === undefined) return new Response("não encontrado", { status: 404 });
  const traits: AvatarTraits = raw ? parseAvatarTraits(raw, traitsFromSeed(personId)).traits : traitsFromSeed(personId);
  return png(spritePng(composeSprite(traits), { scale: 24, view: "bust", background: BACKGROUND }), versioned);
}

export function echoAvatarResponse(): Response {
  return png(spritePng(composeEchoSprite(), { scale: 24, view: "bust", background: BACKGROUND }), false);
}

function png(body: Buffer, versioned: boolean): Response {
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "image/png",
      // Com `?v=` (a chave dos traços), o endereço muda quando o desenho muda: pode ficar em cache para sempre.
      "cache-control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    },
  });
}
