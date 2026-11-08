// Leituras do painel para empresa conectada, contra o Postgres real (DATABASE_URL). Tudo roda numa transação
// desfeita no fim: nenhuma linha fica no banco.
import { randomUUID } from "node:crypto";
import { createDb, createPool, dailyNotes, type Database, fixRuns, morningPlans, orgs, people, pullRequests, questions, reviews, tasks, teams } from "@echo/db";
import { localDate } from "@echo/domain";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { readMorningPlan, readPersonWork, readTeams, readWaiting } from "./pg-panel.ts";

const url = process.env.DATABASE_URL;
const ROLLBACK = "desfazer";
const TZ = "America/Fortaleza";

it.skipIf(!url)("painel da empresa conectada: equipes, trabalho aberto, pendências e plano gravado", async () => {
  const pool = createPool(url!, 1, { defaultScope: "none" });
  const base = createDb(pool);
  const [org, other, team] = [randomUUID(), randomUUID(), randomUUID()];
  const [ana, beto, rh] = [randomUUID(), randomUUID(), randomUUID()];
  const hours = { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" };
  try {
    await base.transaction(async (outer) => {
      await outer.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
      await outer.insert(orgs).values([
        { id: org, name: "Empresa conectada" },
        { id: other, name: "Outra empresa" },
      ]);
      await outer.insert(teams).values([
        { id: team, orgId: org, name: "Plataforma", leaderId: beto },
        { orgId: other, name: "Equipe de outra empresa" },
      ]);
      await outer.insert(people).values([
        { id: ana, orgId: org, teamId: team, name: "Ana Prado", role: "member", timezone: TZ, workHours: hours },
        { id: beto, orgId: org, teamId: team, name: "Beto Reis", role: "leader", timezone: TZ, workHours: hours },
        { id: rh, orgId: org, name: "Rita RH", role: "hr", timezone: TZ, workHours: hours },
      ]);
      await outer.insert(tasks).values([
        { orgId: org, key: "PLA-7", title: "Fila de reenvio", assigneeId: ana, state: "in_progress", dueDate: "2026-12-01" },
        { orgId: org, key: "PLA-8", title: "Já entregue", assigneeId: ana, state: "done" },
        { orgId: org, key: "PLA-9", title: "Do Beto", assigneeId: beto, state: "todo" },
      ]);
      const openedAt = new Date(Date.now() - 3 * 86_400_000);
      const [prAna] = await outer
        .insert(pullRequests)
        .values({ orgId: org, repository: "teste/app", number: 12, title: "Reenvio com espera", authorId: ana, state: "open", branch: "pla-7-reenvio", reviewerIds: [beto], openedAt, taskKey: "PLA-7" })
        .returning({ id: pullRequests.id });
      await outer.insert(pullRequests).values([
        { orgId: org, repository: "teste/app", number: 13, title: "Painel novo", authorId: beto, state: "open", branch: "pla-9-painel", reviewerIds: [ana], openedAt },
        { orgId: org, repository: "teste/app", number: 11, title: "Antigo", authorId: ana, state: "merged", branch: "pla-1" },
      ]);
      const [review] = await outer.insert(reviews).values({ orgId: org, prId: prAna!.id, headSha: "abc", state: "fix_ready" }).returning({ id: reviews.id });
      await outer.insert(fixRuns).values({ orgId: org, reviewId: review!.id, state: "ready", draftPrNumber: 14, testsReported: "passou" });
      await outer.insert(questions).values({ orgId: org, askerId: beto, ownerId: ana, kind: "gemeo", channel: "painel", text: "posso mexer na pla-7-reenvio?", textExpiresAt: new Date(Date.now() + 86_400_000), needsOwner: true, state: "answered" });
      const now = new Date();
      const today = localDate(now, TZ);
      await outer.insert(dailyNotes).values({ orgId: org, personId: ana, date: today, stoppedAt: "PR 12 aberto", state: "draft" });
      await outer.insert(morningPlans).values({ orgId: org, personId: ana, date: today, items: [{ id: "review:teste/app#13", kind: "review_request", text: "PR 13 de Beto espera sua revisão", reason: "revisão pedida a você, há 3 dias", ref: "github:pr/13" }] });

      const db = outer as unknown as Database;

      expect(await readTeams(db, org)).toEqual([{ id: team, name: "Plataforma", leaderId: beto }]);

      const work = await readPersonWork(db, org, ana);
      expect(work.tasks.map((t) => t.key)).toEqual(["PLA-7"]);
      expect(work.pullRequests.map((p) => p.number)).toEqual([12]);
      expect(work.reviews.map((p) => p.number)).toEqual([13]);
      // O rascunho não vale para quem pergunta: a última nota que vale ainda não existe.
      expect(work.note).toBeNull();

      const waiting = await readWaiting(db, org, ana, now);
      expect(waiting.map((w) => w.kind).sort()).toEqual(["daily_note", "fix_ready", "question", "review_request"]);
      expect(waiting.find((w) => w.kind === "fix_ready")).toMatchObject({ text: "Correção pronta no seu PR 12, aguardando sua aprovação" });
      expect(waiting.find((w) => w.kind === "question")).toMatchObject({ text: "Beto deixou uma pergunta sobre pla-7-reenvio e está esperando" });
      expect(waiting.find((w) => w.kind === "review_request")).toMatchObject({ text: "PR 13 de Beto espera sua revisão" });
      expect(waiting.find((w) => w.kind === "daily_note")!.text).toMatch(/^Nota do dia de \d{2}\/\d{2} esperando a sua confirmação$/);
      // Beto: a revisão do PR 12 foi pedida a ele.
      expect((await readWaiting(db, org, beto, now)).map((w) => w.text)).toEqual(["PR 12 de Ana espera sua revisão"]);
      // O RH não tem pendências de trabalho; quem não é da empresa, nada.
      expect(await readWaiting(db, org, rh, now)).toEqual([]);
      expect(await readWaiting(db, other, ana, now)).toEqual([]);

      expect(await readMorningPlan(db, org, ana, today)).toEqual([expect.objectContaining({ kind: "review_request", text: "PR 13 de Beto espera sua revisão" })]);
      expect(await readMorningPlan(db, org, beto, today)).toBeNull();
      // Outra empresa não lê o plano.
      expect(await readMorningPlan(db, other, ana, today)).toBeNull();
      throw new Error(ROLLBACK);
    });
  } catch (err) {
    if (!(err instanceof Error && err.message === ROLLBACK)) throw err;
  } finally {
    await pool.end();
  }
});
