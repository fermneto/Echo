import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link assinado do vídeo da semana: só quem a página autorizou (quem vê a equipe: ela, a liderança e o RH que a
 * acompanha) recebe o endereço, que expira. A assinatura cobre empresa, vídeo e validade.
 */

/** Validade do link: uma hora, o bastante para assistir sem deixar o endereço valendo para sempre. */
export const VIDEO_LINK_TTL_S = 3600;

const mac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("base64url");

export function signedVideoPath(secret: string, orgId: string, id: string, nowS = Math.floor(Date.now() / 1000)): string {
  const exp = nowS + VIDEO_LINK_TTL_S;
  return `/api/video/${orgId}/${id}?exp=${exp}&sig=${mac(secret, `${orgId}:${id}:${exp}`)}`;
}

export function verifyVideoLink(secret: string, orgId: string, id: string, exp: string | null, sig: string | null, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp) || Number(exp) < nowS) return false;
  const want = Buffer.from(mac(secret, `${orgId}:${id}:${exp}`));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
