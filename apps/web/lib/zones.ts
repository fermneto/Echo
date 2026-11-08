/**
 * Fusos que o painel oferece no cadastro, com a cidade de exibição, o código curto ("FOR 03:12") e a posição
 * no mapa. A mesma lista serve ao formulário do RH e à equipe carregada do banco.
 */

export type Zone = { tz: string; city: string; cityCode: string; location: [number, number]; label: string };

export const ZONES: readonly Zone[] = [
  { tz: "America/Sao_Paulo", city: "São Paulo", cityCode: "SAO", location: [-23.55, -46.63], label: "São Paulo (UTC−3)" },
  { tz: "America/Fortaleza", city: "Fortaleza", cityCode: "FOR", location: [-3.73, -38.53], label: "Fortaleza (UTC−3)" },
  { tz: "America/Manaus", city: "Manaus", cityCode: "MAO", location: [-3.12, -60.02], label: "Manaus (UTC−4)" },
  { tz: "America/Mexico_City", city: "Cidade do México", cityCode: "MEX", location: [19.43, -99.13], label: "Cidade do México (UTC−6)" },
  { tz: "America/New_York", city: "Nova York", cityCode: "NYC", location: [40.71, -74.0], label: "Nova York (UTC−5)" },
  { tz: "Europe/Lisbon", city: "Lisboa", cityCode: "LIS", location: [38.72, -9.14], label: "Lisboa (UTC+0)" },
  { tz: "Europe/Berlin", city: "Berlim", cityCode: "BER", location: [52.52, 13.4], label: "Berlim (UTC+1)" },
  { tz: "Africa/Lagos", city: "Lagos", cityCode: "LOS", location: [6.52, 3.38], label: "Lagos (UTC+1)" },
  { tz: "Africa/Johannesburg", city: "Joanesburgo", cityCode: "JNB", location: [-26.2, 28.05], label: "Joanesburgo (UTC+2)" },
  { tz: "Asia/Dubai", city: "Dubai", cityCode: "DXB", location: [25.2, 55.27], label: "Dubai (UTC+4)" },
  { tz: "Asia/Kolkata", city: "Bangalore", cityCode: "BLR", location: [12.97, 77.59], label: "Bangalore (UTC+5:30)" },
  { tz: "Asia/Singapore", city: "Singapura", cityCode: "SIN", location: [1.35, 103.82], label: "Singapura (UTC+8)" },
  { tz: "Asia/Seoul", city: "Seul", cityCode: "SEL", location: [37.57, 126.98], label: "Seul (UTC+9)" },
  { tz: "Asia/Tokyo", city: "Tóquio", cityCode: "TYO", location: [35.68, 139.65], label: "Tóquio (UTC+9)" },
  { tz: "Australia/Sydney", city: "Sydney", cityCode: "SYD", location: [-33.87, 151.21], label: "Sydney (UTC+10)" },
];

export function zoneOf(tz: string): Zone | undefined {
  return ZONES.find((z) => z.tz === tz);
}
