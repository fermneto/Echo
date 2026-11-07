/** Geometria do globo de pontos: esfera unitária, rotação por longitude (phi) e inclinação (theta). */

export type Vec3 = [number, number, number];

const RAD = Math.PI / 180;

/** Vetor unitário de uma latitude/longitude, com a longitude 0 de frente para quem olha. */
export function toVec(lat: number, lng: number): Vec3 {
  const la = lat * RAD;
  const lo = lng * RAD;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

/**
 * Gira o globo para deixar a longitude `phi` (radianos) no centro e inclina por `theta`.
 * Devolve x à direita, y para cima e z para quem olha (z > 0 = face visível).
 */
export function rotate([x, y, z]: Vec3, phi: number, theta: number): Vec3 {
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const x1 = x * cp - z * sp;
  const z1 = x * sp + z * cp;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  return [x1, y * ct - z1 * st, y * st + z1 * ct];
}

/** Distância angular em graus entre dois vetores unitários. */
export function angleDeg(a: Vec3, b: Vec3): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d))) / RAD;
}

/** Pontos distribuídos por igual na esfera (espiral de Fibonacci), em latitude/longitude. */
export function fibonacciLatLng(n: number): [number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const lng = ((((i * golden) / RAD) % 360) + 540) % 360 - 180;
    out.push([Math.asin(y) / RAD, lng]);
  }
  return out;
}

/** Ponto do arco entre a e b (0 ≤ s ≤ 1), elevado acima da superfície no meio do caminho. */
export function arcPoint(a: Vec3, b: Vec3, s: number, lift: number): Vec3 {
  const omega = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const so = Math.sin(omega) || 1;
  const ka = Math.sin((1 - s) * omega) / so;
  const kb = Math.sin(s * omega) / so;
  const h = 1 + lift * Math.sin(Math.PI * s);
  return [(a[0] * ka + b[0] * kb) * h, (a[1] * ka + b[1] * kb) * h, (a[2] * ka + b[2] * kb) * h];
}
