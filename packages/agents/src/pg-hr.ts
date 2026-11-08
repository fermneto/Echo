// Visão das equipes para o RH em Postgres. Toda consulta em withOrg com filtro explícito de org_id. Só ids, datas,
// estados e os números dos relatórios enviados: nenhum texto de pergunta, nota ou relatório sai daqui.
import { absences, type Database, people, questions, teams, weeklyReports, withOrg } from "@echo/db";
import { HR_OVERVIEW_RULES, type HrOverview, hrOverview, localDate, recentWeeks, weekMonday } from "@echo/domain";
import { and, eq, gt, gte, inArray, isNotNull, lte } from "drizzle-orm";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Equipes em `teamIds` (as que o RH acompanha), com as últimas semanas até a de `now`. */
export async function readHrOverview(db: Database, orgId: string, teamIds: readonly string[], now: Date, timeZone = "UTC"): Promise<HrOverview> {
  const weeks = recentWeeks(localDate(now, timeZone));
  if (teamIds.length === 0) return hrOverview({ teams: [], people: [], reports: [], twinAnswers: [], absences: [], weeks, now });
  // Um dia de folga antes da primeira segunda cobre quem está em fuso adiantado.
  const since = new Date(`${weekMonday(weeks[0]!)}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 1);

  return withOrg(db, orgId, async (tx) => {
    const ts = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.orgId, orgId), inArray(teams.id, [...teamIds])));
    const ppl = await tx
      .select({ id: people.id, teamId: people.teamId, role: people.role, active: people.active, name: people.name, timezone: people.timezone })
      .from(people)
      .where(and(eq(people.orgId, orgId), inArray(people.teamId, ts.map((t) => t.id))));
    const ids = ppl.map((p) => p.id);
    if (ids.length === 0) return hrOverview({ teams: ts, people: [], reports: [], twinAnswers: [], absences: [], weeks, now });

    const reports = await tx
      .select({ personId: weeklyReports.personId, week: weeklyReports.week, state: weeklyReports.state, metrics: weeklyReports.metrics })
      .from(weeklyReports)
      .where(and(eq(weeklyReports.orgId, orgId), inArray(weeklyReports.personId, ids), inArray(weeklyReports.week, weeks), inArray(weeklyReports.state, [...HR_OVERVIEW_RULES.sentStates])));
    const answers = await tx
      .select({ ownerId: questions.ownerId, answeredAt: questions.answeredAt })
      .from(questions)
      .where(and(eq(questions.orgId, orgId), eq(questions.kind, "gemeo"), eq(questions.state, "answered"), inArray(questions.ownerId, ids), isNotNull(questions.answeredAt), gte(questions.answeredAt, since)));
    const away = await tx
      .select({ personId: absences.personId, kind: absences.kind, startsAt: absences.startsAt, endsAt: absences.endsAt })
      .from(absences)
      .where(and(eq(absences.orgId, orgId), inArray(absences.personId, ids), lte(absences.startsAt, now), gt(absences.endsAt, now)));

    return hrOverview({
      teams: ts.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      people: ppl.map((p) => ({ ...p, teamId: p.teamId ?? undefined })),
      reports: reports.map((r) => {
        const m = (r.metrics ?? {}) as Record<string, unknown>;
        return { personId: r.personId, week: r.week, state: r.state, metrics: { deliveries: num(m.deliveries), reviews: num(m.reviews), helps: num(m.helps) } };
      }),
      twinAnswers: answers.flatMap((a) => (a.ownerId && a.answeredAt ? [{ ownerId: a.ownerId, answeredAt: a.answeredAt }] : [])),
      absences: away,
      weeks,
      now,
    });
  });
}
