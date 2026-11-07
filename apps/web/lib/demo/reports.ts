/**
 * Relatório semanal (F7), SINTÉTICO. Os números vêm de regra (weeklyMetrics em packages/domain
 * quando existir); o texto da pessoa nunca altera um número e aparece marcado como informado.
 */

export type Help = { to: string; what: string; source: string };
export type WeekReport = {
  personId: string;
  week: string;
  deliveries: number;
  commits: number;
  reviews: number;
  helps: Help[];
  delays: string[];
};

const REPORTS: Record<string, WeekReport> = {
  carla: {
    personId: "carla",
    week: "02 a 06/11",
    deliveries: 0,
    commits: 2,
    reviews: 3,
    helps: [
      { to: "Bruno", what: "destravou a ECH-133", source: "reação de obrigado no Slack" },
      { to: "Fernando", what: "revisão do PR 31 seguida de mudança no código", source: "GitHub" },
      { to: "Eduardo", what: "revisão do PR 33 seguida de mudança no código", source: "GitHub" },
      { to: "Yan", what: "coautoria num commit da ECH-140", source: "GitHub" },
      { to: "Marina", what: "ajudou no plano de plantão de pagamentos", source: "confirmação no painel" },
    ],
    delays: [],
  },
  fernando: { personId: "fernando", week: "02 a 06/11", deliveries: 1, commits: 7, reviews: 0, helps: [], delays: [] },
  eduardo: { personId: "eduardo", week: "02 a 06/11", deliveries: 1, commits: 5, reviews: 2, helps: [{ to: "Fernando", what: "revisão do PR 39 seguida de mudança no código", source: "GitHub" }], delays: [] },
};

export function reportFor(id: string): WeekReport {
  return REPORTS[id] ?? { personId: id, week: "02 a 06/11", deliveries: 0, commits: 0, reviews: 0, helps: [], delays: [] };
}

/** Relatórios que já seguiram ao RH (o que a Rita vê). */
export const SENT_TO_HR = ["carla", "fernando", "eduardo"] as const;

/** Frase do resumo, montada por regra a partir dos números (o modelo só redigiria isto). */
export function summaryLine(name: string, r: WeekReport): string {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  return `${name} registrou na semana ${n(r.deliveries, "entrega", "entregas")}, ${n(r.commits, "commit", "commits")} e ${n(r.reviews, "revisão", "revisões")}, e ${n(r.helps.length, "ajuda confirmada", "ajudas confirmadas")} a colegas.`;
}
