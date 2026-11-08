// Vídeo da semana da equipe no Postgres, sempre em withOrg com filtro explícito de org_id. Os fatos saem só dos
// relatórios semanais já liberados ao RH (conferidos pela pessoa ou passado o prazo); só o código do fluxo escreve.
import { absences, agentRuns, type Database, deployments, identities, orgs, people, pullRequests, questions, tasks, teams, teamVideos, weeklyReports, withOrg } from "@echo/db";
import { type AbsenceKind, type AvatarTraits, localDate, type Person, type PersonRole, RELEASED_REPORT_STATES, teamVideoDue, parseAvatarTraits, pickVideoDeliveries, type PrState, type PullRequest, traitsFromSeed, type TeamWeekFacts, type VideoCandidate, type WeeklyMetrics } from "@echo/domain";
import { and, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { TeamVideoPatch, TeamVideoRow, TeamVideoState, TeamVideoStore, TeamVideoStory } from "./video.ts";

type PrRow = typeof pullRequests.$inferSelect;
const toPr = (r: PrRow): PullRequest => ({
  id: r.id,
  repository: r.repository,
  number: r.number,
  title: r.title,
  authorId: r.authorId ?? undefined,
  state: r.state as PrState,
  branch: r.branch,
  files: r.files,
  taskKey: r.taskKey ?? undefined,
  reviewerIds: r.reviewerIds,
  openedAt: r.openedAt ?? undefined,
  mergedAt: r.mergedAt ?? undefined,
  headSha: r.headSha ?? undefined,
});

/** "2 a 6/11" (ou "30/10 a 3/11"), no fuso de quem abre a equipe. */
export function weekLabel(from: Date, to: Date, timeZone: string): string {
  const a = localDate(from, timeZone);
  const b = localDate(new Date(to.getTime() - 1), timeZone);
  const d = (x: string) => String(Number(x.slice(8, 10)));
  const m = (x: string) => String(Number(x.slice(5, 7)));
  return m(a) === m(b) ? `${d(a)} a ${d(b)}/${m(b)}` : `${d(a)}/${m(a)} a ${d(b)}/${m(b)}`;
}

export function createPgTeamVideoStore(db: Database): TeamVideoStore {
  return {
    async facts(orgId, teamId, week) {
      return withOrg(db, orgId, async (tx) => {
        const [team] = await tx.select({ name: teams.name }).from(teams).where(and(eq(teams.orgId, orgId), eq(teams.id, teamId)));
        if (!team) return null;
        const members = await tx
          .select({ id: people.id, name: people.name, timezone: people.timezone, avatar: people.avatar })
          .from(people)
          .where(and(eq(people.orgId, orgId), eq(people.teamId, teamId), eq(people.active, true)));
        if (!members.length) return null;
        const ids = members.map((m) => m.id);
        // Só relatórios liberados ao RH: o que ainda está em conferência não entra (nem entregas, nem ajudas).
        const reports = await tx
          .select()
          .from(weeklyReports)
          .where(and(eq(weeklyReports.orgId, orgId), eq(weeklyReports.week, week), inArray(weeklyReports.personId, ids), inArray(weeklyReports.state, [...RELEASED_REPORT_STATES])));
        if (!reports.length) return null;
        const releasedIds = [...new Set(reports.map((r) => r.personId))];
        const from = new Date(Math.min(...reports.map((r) => Date.parse(r.coveredPeriod.from))));
        const to = new Date(Math.max(...reports.map((r) => Date.parse(r.coveredPeriod.to))));

        // Entregas: as referências de cada relatório, com o título da tarefa (Linear) ou do PR (repo#número).
        const refs = reports.flatMap((r) => ((r.metrics as WeeklyMetrics).deliveryRefs ?? []).map((ref) => ({ ref, personId: r.personId })));
        const keys = refs.map((x) => x.ref).filter((ref) => !ref.includes("#"));
        const taskTitles = keys.length ? new Map((await tx.select({ key: tasks.key, title: tasks.title }).from(tasks).where(and(eq(tasks.orgId, orgId), inArray(tasks.key, keys)))).map((t) => [t.key, t.title])) : new Map<string, string>();
        const prRows = await tx
          .select()
          .from(pullRequests)
          .where(and(eq(pullRequests.orgId, orgId), inArray(pullRequests.authorId, ids), eq(pullRequests.state, "merged"), gte(pullRequests.mergedAt, from), lt(pullRequests.mergedAt, to)));
        const prTitle = (ref: string) => {
          const [repo, n] = ref.split("#");
          return prRows.find((p) => p.repository === repo && String(p.number) === n)?.title;
        };
        const deliveries = refs.map((x) => ({ ref: x.ref, personId: x.personId, title: taskTitles.get(x.ref) ?? prTitle(x.ref) ?? x.ref }));

        // Ajudas: quem cada relatório diz ter ajudado (crédito confirmado), só entre pessoas da equipe.
        const known = new Set(ids);
        const helps = reports.flatMap((r) => ((r.metrics as WeeklyMetrics).helped ?? []).filter((h) => known.has(h.personId)).map((h) => ({ fromId: r.personId, toId: h.personId, count: h.count })));

        // Gêmeos em ação: perguntas que o gêmeo respondeu com o dono fora, na semana.
        const answered = await tx
          .select({ ownerId: questions.ownerId, n: sql<number>`count(*)` })
          .from(questions)
          .where(and(eq(questions.orgId, orgId), inArray(questions.ownerId, ids), eq(questions.kind, "gemeo"), eq(questions.state, "answered"), gte(questions.answeredAt, from), lt(questions.answeredAt, to)))
          .groupBy(questions.ownerId);
        const twins = { answered: answered.reduce((s, a) => s + Number(a.n), 0), peopleIds: answered.map((a) => a.ownerId).filter((x): x is string => Boolean(x)) };

        // Trechos de tela: entregas com tela e preview pronto, as mais recentes primeiro.
        const shas = prRows.map((p) => p.headSha).filter((s): s is string => Boolean(s));
        const deps = shas.length
          ? await tx.select({ repository: deployments.repository, sha: deployments.sha, environment: deployments.environment, state: deployments.state, url: deployments.url }).from(deployments).where(and(eq(deployments.orgId, orgId), inArray(deployments.sha, shas)))
          : [];
        const prs = prRows.map(toPr);
        const previews = deps.map((d) => ({ repository: d.repository ?? undefined, sha: d.sha ?? undefined, environment: d.environment, state: d.state, url: d.url ?? undefined }));
        const candidates: VideoCandidate[] = releasedIds
          .flatMap((id) => pickVideoDeliveries(id, prs, previews, { from, to }))
          .sort((a, b) => (b.pr.mergedAt?.getTime() ?? 0) - (a.pr.mergedAt?.getTime() ?? 0))
          .slice(0, 3);

        const avatar = (m: (typeof members)[number]): AvatarTraits => (m.avatar ? parseAvatarTraits(m.avatar, traitsFromSeed(m.id)).traits : traitsFromSeed(m.id));
        const facts: TeamWeekFacts = {
          teamName: team.name,
          weekLabel: weekLabel(from, to, members[0]!.timezone),
          people: members.map((m) => ({ id: m.id, name: m.name, avatar: avatar(m) })),
          deliveries,
          helps,
          twins,
          clips: [],
        };
        return { facts, candidates };
      });
    },

    async audience(orgId, teamId) {
      return withOrg(db, orgId, async (tx) => {
        const [team] = await tx.select({ leaderId: teams.leaderId }).from(teams).where(and(eq(teams.orgId, orgId), eq(teams.id, teamId)));
        const leaderId = team?.leaderId ?? null;
        const rows = await tx
          .select()
          .from(people)
          .where(and(eq(people.orgId, orgId), isNull(people.offboardedAt), leaderId ? or(eq(people.teamId, teamId), eq(people.id, leaderId)) : eq(people.teamId, teamId)));
        if (!rows.length) return { leaderId, people: [], absences: [], slackIds: [] };
        const ids = rows.map((r) => r.id);
        const away = await tx.select().from(absences).where(and(eq(absences.orgId, orgId), inArray(absences.personId, ids), isNull(absences.cancelledAt)));
        const slack = await tx.select({ personId: identities.personId }).from(identities).where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack"), inArray(identities.personId, ids)));
        return {
          leaderId,
          people: rows.map((r): Person => ({ id: r.id, orgId: r.orgId, name: r.name, role: r.role as PersonRole, teamId: r.teamId ?? undefined, timezone: r.timezone, workHours: r.workHours, skills: r.skills, areas: r.areas, active: r.active })),
          absences: away.map((a) => ({ personId: a.personId, startsAt: a.startsAt, endsAt: a.endsAt, kind: a.kind as AbsenceKind, inferred: a.inferred })),
          slackIds: [...new Set(slack.map((x) => x.personId))],
        };
      });
    },

    async get(orgId, id) {
      const [r] = await withOrg(db, orgId, (tx) => tx.select().from(teamVideos).where(and(eq(teamVideos.orgId, orgId), eq(teamVideos.id, id))));
      return r ? toRow(r) : null;
    },

    async transition(orgId, id, from, to, patch: TeamVideoPatch = {}) {
      const set: Partial<typeof teamVideos.$inferInsert> = { state: to, updatedAt: new Date() };
      if (patch.story !== undefined) set.story = patch.story;
      if (patch.storageKey !== undefined) set.storageKey = patch.storageKey;
      if (patch.durationS !== undefined) set.durationS = patch.durationS;
      if (patch.chapters !== undefined) set.chapters = patch.chapters;
      if (patch.costUsd !== undefined) set.costUsd = patch.costUsd.toFixed(4);
      if (patch.expiresAt !== undefined) set.expiresAt = patch.expiresAt;
      if (patch.sessionId !== undefined) set.sessionId = patch.sessionId;
      if (patch.attempts !== undefined) set.attempts = patch.attempts;
      if (patch.error !== undefined) set.error = patch.error?.slice(0, 300) ?? null;
      const done = await withOrg(db, orgId, (tx) =>
        tx
          .update(teamVideos)
          .set(set)
          .where(and(eq(teamVideos.orgId, orgId), eq(teamVideos.id, id), eq(teamVideos.state, from)))
          .returning({ id: teamVideos.id }),
      );
      return done.length > 0;
    },

    async budget(orgId, since) {
      return withOrg(db, orgId, async (tx) => {
        const [spent] = await tx.select({ total: sql<string | null>`sum(${agentRuns.costUsd})` }).from(agentRuns).where(and(eq(agentRuns.orgId, orgId), gte(agentRuns.createdAt, since)));
        const [org] = await tx.select({ limit: orgs.monthlyLimitUsd }).from(orgs).where(eq(orgs.id, orgId));
        return { spentUsd: Number(spent?.total ?? 0), monthlyLimitUsd: Number(org?.limit ?? 0) };
      });
    },
  };
}

function toRow(v: typeof teamVideos.$inferSelect): TeamVideoRow {
  return { id: v.id, orgId: v.orgId, teamId: v.teamId, week: v.week, state: v.state as TeamVideoState, attempts: v.attempts, storageKey: v.storageKey };
}

// ---------- Agenda (worker)

/**
 * Equipes com relatórios da semana já liberados ao RH e sem vídeo. A decisão é a regra pura `teamVideoDue`
 * (packages/domain): a mesma liberação do relatório (conferência da pessoa e 3 dias, ou sem aviso em 7), com todos
 * da equipe liberados ou 24 h depois do primeiro liberado.
 */
export async function queueTeamVideos(db: Database, orgId: string, now: Date): Promise<number> {
  return withOrg(db, orgId, async (tx) => {
    const recent = await tx
      .select({ teamId: people.teamId, week: weeklyReports.week, state: weeklyReports.state, sentAt: weeklyReports.sentAt })
      .from(weeklyReports)
      .innerJoin(people, eq(people.id, weeklyReports.personId))
      .where(and(eq(weeklyReports.orgId, orgId), isNotNull(people.teamId), inArray(weeklyReports.state, [...RELEASED_REPORT_STATES]), gte(weeklyReports.sentAt, new Date(now.getTime() - 7 * 86_400_000))));
    const existing = await tx.select({ teamId: teamVideos.teamId, week: teamVideos.week }).from(teamVideos).where(eq(teamVideos.orgId, orgId));
    const done = new Set(existing.map((e) => `${e.teamId}:${e.week}`));
    const groups = new Map<string, { teamId: string; week: string; reports: { state: string; sentAt: Date | null }[] }>();
    for (const r of recent) {
      const key = `${r.teamId}:${r.week}`;
      if (done.has(key)) continue;
      const g = groups.get(key) ?? { teamId: r.teamId!, week: r.week, reports: [] };
      g.reports.push({ state: r.state, sentAt: r.sentAt });
      groups.set(key, g);
    }
    let n = 0;
    for (const g of groups.values()) {
      const [count] = await tx.select({ members: sql<number>`count(*)` }).from(people).where(and(eq(people.orgId, orgId), eq(people.teamId, g.teamId), eq(people.active, true)));
      if (!teamVideoDue(Number(count?.members ?? 0), g.reports, now)) continue;
      const rows = await tx.insert(teamVideos).values({ orgId, teamId: g.teamId, week: g.week }).onConflictDoNothing().returning({ id: teamVideos.id });
      n += rows.length;
    }
    return n;
  });
}

/** Vídeos na fila, os mais antigos primeiro. */
export async function queuedTeamVideos(db: Database, orgId: string, limit = 3): Promise<string[]> {
  const rows = await withOrg(db, orgId, (tx) => tx.select({ id: teamVideos.id }).from(teamVideos).where(and(eq(teamVideos.orgId, orgId), eq(teamVideos.state, "queued"))).orderBy(teamVideos.createdAt).limit(limit));
  return rows.map((r) => r.id);
}

/** Gravação parada no meio (worker caiu): vira falha. */
export async function failStuckTeamVideos(db: Database, orgId: string, before: Date): Promise<number> {
  const rows = await withOrg(db, orgId, (tx) =>
    tx
      .update(teamVideos)
      .set({ state: "failed", error: "gravação interrompida", updatedAt: new Date() })
      .where(and(eq(teamVideos.orgId, orgId), eq(teamVideos.state, "recording"), lt(teamVideos.updatedAt, before)))
      .returning({ id: teamVideos.id }),
  );
  return rows.length;
}

/** Vídeos vencidos (retenção): saem do armazenamento. Devolve os arquivos a apagar. */
export async function expireTeamVideos(db: Database, orgId: string, at: Date): Promise<string[]> {
  return withOrg(db, orgId, async (tx) => {
    const rows = await tx.select({ id: teamVideos.id, key: teamVideos.storageKey }).from(teamVideos).where(and(eq(teamVideos.orgId, orgId), isNotNull(teamVideos.storageKey), lt(teamVideos.expiresAt, at)));
    if (rows.length) await tx.update(teamVideos).set({ storageKey: null, updatedAt: at }).where(inArray(teamVideos.id, rows.map((r) => r.id)));
    return rows.map((r) => r.key!).filter(Boolean);
  });
}

// ---------- Painel

export interface TeamVideoView {
  id: string;
  teamId: string;
  teamName: string;
  week: string;
  weekLabel: string;
  state: TeamVideoState;
  durationS: number | null;
  chapters: { at: number; title: string }[];
  playable: boolean;
}

/** Último vídeo de cada equipe pedida (pronto ou em produção), para a página de relatórios. */
export async function latestTeamVideos(db: Database, orgId: string, teamIds: readonly string[]): Promise<TeamVideoView[]> {
  if (!teamIds.length) return [];
  return withOrg(db, orgId, async (tx) => {
    const rows = await tx
      .select({ v: teamVideos, teamName: teams.name })
      .from(teamVideos)
      .innerJoin(teams, eq(teams.id, teamVideos.teamId))
      .where(and(eq(teamVideos.orgId, orgId), inArray(teamVideos.teamId, [...teamIds]), inArray(teamVideos.state, ["queued", "recording", "ready"])))
      .orderBy(sql`${teamVideos.week} desc`);
    const seen = new Set<string>();
    const out: TeamVideoView[] = [];
    for (const { v, teamName } of rows) {
      if (seen.has(v.teamId)) continue;
      seen.add(v.teamId);
      const story = v.story as TeamVideoStory | null;
      out.push({
        id: v.id,
        teamId: v.teamId,
        teamName,
        week: v.week,
        weekLabel: story?.facts.weekLabel ?? v.week,
        state: v.state as TeamVideoState,
        durationS: v.durationS,
        chapters: v.chapters ?? [],
        playable: v.state === "ready" && Boolean(v.storageKey),
      });
    }
    return out;
  });
}

/** Arquivo de um vídeo pronto e de qual equipe ele é, para a rota que serve o mp4 conferir o acesso. */
export async function teamVideoForStream(db: Database, orgId: string, id: string): Promise<{ storageKey: string; teamId: string } | null> {
  const [r] = await withOrg(db, orgId, (tx) => tx.select({ key: teamVideos.storageKey, teamId: teamVideos.teamId, state: teamVideos.state }).from(teamVideos).where(and(eq(teamVideos.orgId, orgId), eq(teamVideos.id, id))));
  return r?.key && r.state === "ready" ? { storageKey: r.key, teamId: r.teamId } : null;
}
