/**
 * As três equipes da demonstração, com os mesmos ids do seed (seed/src/demo.ts → DEMO_IDS.teams).
 * Assim a persona da demo e a pessoa do banco caem na mesma equipe.
 */

export type DemoTeam = { id: string; name: string; leaderId: string };

export const TEAMS: readonly DemoTeam[] = [
  { id: "00000000-0000-4000-8000-000000000010", name: "Produto", leaderId: "marina" },
  { id: "00000000-0000-4000-8000-000000000011", name: "Dados e plataforma", leaderId: "jonas" },
  { id: "00000000-0000-4000-8000-000000000012", name: "Aplicativo e qualidade", leaderId: "ines" },
];

const [PRODUTO, DADOS, APP] = TEAMS.map((t) => t.id) as [string, string, string];

/** Equipe de cada pessoa do mapa. O RH (Rita) não pertence a nenhuma. */
export const TEAM_OF: Readonly<Record<string, string>> = {
  fernando: PRODUTO,
  eduardo: PRODUTO,
  yan: PRODUTO,
  marina: PRODUTO,
  bruno: PRODUTO,
  carla: PRODUTO,
  ana: DADOS,
  amara: DADOS,
  wei: DADOS,
  jonas: DADOS,
  omar: DADOS,
  noah: APP,
  lucia: APP,
  ines: APP,
  priya: APP,
  jiwoo: APP,
  olivia: APP,
};

/** Quem lidera cada equipe nova; o resto do mapa é membro. */
export const LEADERS: ReadonlySet<string> = new Set(TEAMS.map((t) => t.leaderId));

/** Todos trabalham no fim de semana e folgam só na terça (0 = domingo … 6 = sábado). Igual ao seed. */
export const WORK_DAYS = [0, 1, 3, 4, 5, 6];
