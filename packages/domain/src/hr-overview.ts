// Visão das equipes para o RH: entregas, revisões e ajudas dos relatórios já enviados, respostas dos gêmeos e quem
// está fora, somados por equipe e por semana. Só totais de equipe com ao menos `GAINS_RULES.minPeople` pessoas:
// nada por pessoa, sem nota e sem ranking.
import { GAINS_RULES } from "./gains.ts";
import { isoWeek, weekMonday } from "./report.ts";
import type { WeeklyMetrics } from "./rules.ts";
import { addDays, localDate } from "./time.ts";

export const HR_OVERVIEW_RULES = {
  /** Semanas da evolução, contando a atual. */
  weeks: 8,
  /** Estados que já seguiram ao RH. Rascunho e conferência não entram. */
  sentStates: ["sent", "sent_without_notice"] as readonly string[],
  minPeople: GAINS_RULES.minPeople,
} as const;

export type HrPerson = { id: string; teamId?: string | undefined; role: string; active: boolean; name: string; timezone: string };
export type HrReport = { personId: string; week: string; state: string; metrics: Pick<WeeklyMetrics, "deliveries" | "reviews" | "helps"> };
export type HrAbsence = { personId: string; kind: string; startsAt: Date; endsAt: Date };

export type HrWeek = {
  week: string;
  /** Segunda-feira da semana (AAAA-MM-DD). */
  monday: string;
  deliveries: number;
  reviews: number;
  helps: number;
  /** Respostas dos gêmeos a perguntas sobre quem é da equipe. */
  twins: number;
  /** Relatórios enviados ao RH nesta semana. */
  sent: number;
};

export type HrTeam =
  | { id: string; name: string; status: "ok"; people: number; weeks: HrWeek[]; away: { name: string; kind: string; until: Date }[] }
  | { id: string; name: string; status: "too_small"; people: number; min: number };

export type HrOverview = {
  weeks: string[];
  /** A semana em destaque: a mais recente com relatório enviado (a atual só fecha dias depois). */
  focus: string;
  teams: HrTeam[];
  /** Soma das equipes mostradas, por semana. */
  total: HrWeek[];
};

/** As últimas `n` semanas ISO até a de `today` (AAAA-MM-DD), da mais antiga para a atual. */
export function recentWeeks(today: string, n: number = HR_OVERVIEW_RULES.weeks): string[] {
  const monday = weekMonday(isoWeek(today))!;
  return Array.from({ length: n }, (_, i) => isoWeek(addDays(monday, (i - n + 1) * 7)));
}

const emptyWeek = (week: string): HrWeek => ({ week, monday: weekMonday(week)!, deliveries: 0, reviews: 0, helps: 0, twins: 0, sent: 0 });

export function hrOverview(input: {
  teams: readonly { id: string; name: string }[];
  people: readonly HrPerson[];
  reports: readonly HrReport[];
  /** Perguntas respondidas pelo gêmeo: dono e quando. */
  twinAnswers: readonly { ownerId: string; answeredAt: Date }[];
  absences: readonly HrAbsence[];
  weeks: readonly string[];
  now: Date;
}): HrOverview {
  const { weeks, now } = input;
  const members = (teamId: string) => input.people.filter((p) => p.active && p.role !== "hr" && p.teamId === teamId);
  const shown: HrTeam[] = input.teams.map((t) => {
    const ppl = members(t.id);
    if (ppl.length < HR_OVERVIEW_RULES.minPeople) return { id: t.id, name: t.name, status: "too_small", people: ppl.length, min: HR_OVERVIEW_RULES.minPeople };
    const ids = new Map(ppl.map((p) => [p.id, p]));
    const byWeek = new Map(weeks.map((w) => [w, emptyWeek(w)]));
    for (const r of input.reports) {
      const w = byWeek.get(r.week);
      if (!w || !ids.has(r.personId) || !HR_OVERVIEW_RULES.sentStates.includes(r.state)) continue;
      w.deliveries += r.metrics.deliveries;
      w.reviews += r.metrics.reviews;
      w.helps += r.metrics.helps;
      w.sent += 1;
    }
    for (const a of input.twinAnswers) {
      const owner = ids.get(a.ownerId);
      if (!owner) continue;
      const w = byWeek.get(isoWeek(localDate(a.answeredAt, owner.timezone)));
      if (w) w.twins += 1;
    }
    const away = input.absences
      .filter((a) => ids.has(a.personId) && a.startsAt <= now && a.endsAt > now)
      .map((a) => ({ name: ids.get(a.personId)!.name, kind: a.kind, until: a.endsAt }))
      .sort((a, b) => a.until.getTime() - b.until.getTime());
    return { id: t.id, name: t.name, status: "ok", people: ppl.length, weeks: weeks.map((w) => byWeek.get(w)!), away };
  });

  const total = weeks.map((w) => {
    const sum = emptyWeek(w);
    for (const t of shown) {
      if (t.status !== "ok") continue;
      const x = t.weeks.find((y) => y.week === w)!;
      sum.deliveries += x.deliveries;
      sum.reviews += x.reviews;
      sum.helps += x.helps;
      sum.twins += x.twins;
      sum.sent += x.sent;
    }
    return sum;
  });
  const focus = [...total].reverse().find((w) => w.sent > 0)?.week ?? weeks[weeks.length - 1] ?? "";
  return { weeks: [...weeks], focus, teams: shown, total };
}
