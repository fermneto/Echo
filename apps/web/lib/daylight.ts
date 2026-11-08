/**
 * Quanto de luz do dia há num ponto do mapa, de 0 (noite) a 1 (dia), pela altura do sol. A passagem é suave: vai
 * do crepúsculo náutico (sol 12° abaixo do horizonte) até o sol 6° acima, como um gradiente na linha entre dia e
 * noite, que acompanha a latitude e a estação.
 */

const RAD = Math.PI / 180;
const NIGHT_BELOW = -12;
const DAY_ABOVE = 6;

/** Declinação do sol (graus) no dia do ano, pela aproximação de Cooper. */
export function solarDeclination(at: Date): number {
  const start = Date.UTC(at.getUTCFullYear(), 0, 0);
  const day = (at.getTime() - start) / 86_400_000;
  return 23.44 * Math.sin(RAD * (360 / 365) * (day - 81));
}

/** Altura do sol (graus) num ponto, sem equação do tempo nem refração: basta para o desenho. */
export function solarElevation(lat: number, lng: number, at: Date): number {
  const dec = solarDeclination(at) * RAD;
  const utcHours = at.getUTCHours() + at.getUTCMinutes() / 60 + at.getUTCSeconds() / 3600;
  const hourAngle = (utcHours + lng / 15 - 12) * 15 * RAD;
  const sin = Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sin))) / RAD;
}

/** 0 na noite, 1 no dia, com curva suave (smoothstep) no crepúsculo. */
export function daylight(lat: number, lng: number, at: Date): number {
  const t = Math.max(0, Math.min(1, (solarElevation(lat, lng, at) - NIGHT_BELOW) / (DAY_ABOVE - NIGHT_BELOW)));
  return t * t * (3 - 2 * t);
}
