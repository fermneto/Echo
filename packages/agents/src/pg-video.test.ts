// Vídeo da semana da equipe contra o Postgres real (DATABASE_URL), com papel comum (RLS): fatos montados dos
// relatórios, fila por equipe sem duplicar, transição condicional, isolamento entre empresas e vencimento.
import { randomUUID } from "node:crypto";
import { asSystem, createDb, createPool, type Database, deployments, orgs, people, pullRequests, questions, teams, teamVideos, weeklyReports } from "@echo/db";
import { appRoleUrl } from "@echo/db/testing";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgTeamVideoStore, expireTeamVideos, failStuckTeamVideos, latestTeamVideos, queuedTeamVideos, queueTeamVideos, teamVideoForStream, weekLabel } from "./pg-video.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-07T12:00:00Z");

describe("rótulo da semana", () => {
  it("mesmo mês e virada de mês", () => {
    expect(weekLabel(new Date("2026-11-02T03:00:00Z"), new Date("2026-11-07T03:00:00Z"), "America/Sao_Paulo")).toBe("2 a 6/11");
    expect(weekLabel(new Date("2026-10-30T03:00:00Z"), new Date("2026-11-04T03:00:00Z"), "America/Sao_Paulo")).toBe("30/10 a 3/11");
  });
});

describe.skipIf(!url)("vídeo da semana em Postgres", () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let db: Database;
  const [org, other, team, fer, car, out] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const sys = () => createDb(admin);
  const period = { from: "2026-11-02T03:00:00.000Z", to: "2026-11-07T03:00:00.000Z" };
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    admin = createPool(url!, 2, { defaultScope: "none" });
    await asSystem(sys(), async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Semana A", monthlyLimitUsd: "50" }, { id: other, name: "Semana B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto" });
      await tx.insert(people).values([
        { id: fer, orgId: org, teamId: team, name: "Fernando Teste", role: "member", timezone: "America/Sao_Paulo", workHours: hours },
        { id: car, orgId: org, teamId: team, name: "Carla Teste", role: "member", timezone: "America/Sao_Paulo", workHours: hours, avatar: { hair: "bun", hairColor: "auburn", skin: "s1", eyewear: "glasses", facialHair: "none", top: "shirt", topColor: "orange", headwear: "none" } },
        { id: out, orgId: org, name: "Fora da equipe", role: "member", timezone: "America/Sao_Paulo", workHours: hours },
      ]);
      await tx.insert(pullRequests).values({ orgId: org, repository: "echo/app", number: 41, title: "Tela de pagamentos", authorId: fer, state: "merged", branch: "b41", headSha: "sha41", files: ["apps/web/app/pagamentos/page.tsx"], mergedAt: new Date("2026-11-04T12:00:00Z") });
      await tx.insert(deployments).values({ orgId: org, provider: "vercel", externalId: "dpl_s", repository: "echo/app", sha: "sha41", environment: "preview", state: "ready", url: "sha41.vercel.app", occurredAt: new Date("2026-11-04T12:05:00Z") });
      await tx.insert(weeklyReports).values([
        { orgId: org, personId: fer, week: "2026-W45", metrics: { deliveries: 1, commits: 3, reviews: 0, helps: 0, delays: [], deliveryRefs: ["echo/app#41"], helped: [] }, state: "awaiting_owner", coveredPeriod: period, noticeAt: new Date("2026-11-06T21:00:00Z") },
        { orgId: org, personId: car, week: "2026-W45", metrics: { deliveries: 0, commits: 1, reviews: 2, helps: 2, delays: [], deliveryRefs: [], helped: [{ personId: fer, count: 2 }, { personId: out, count: 1 }] }, state: "awaiting_owner", coveredPeriod: period, noticeAt: new Date("2026-11-06T21:30:00Z") },
      ]);
      await tx.insert(questions).values([
        { orgId: org, askerId: car, ownerId: fer, kind: "gemeo", channel: "slack:C1", sourceRef: "s:1", state: "answered", answeredAt: new Date("2026-11-03T02:00:00Z") },
        { orgId: org, askerId: car, ownerId: fer, kind: "gemeo", channel: "slack:C1", sourceRef: "s:2", state: "answered", answeredAt: new Date("2026-11-05T02:00:00Z") },
        { orgId: org, askerId: car, ownerId: fer, kind: "gemeo", channel: "slack:C1", sourceRef: "s:3", state: "failed" },
      ]);
    });
    app = createPool(await appRoleUrl(admin, url!), 2, { defaultScope: "none" });
    db = createDb(app);
  });

  afterAll(async () => {
    await asSystem(sys(), (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await asSystem(sys(), (tx) => tx.delete(orgs).where(eq(orgs.id, other)));
    await app.end();
    await admin.end();
  });

  it("fila por equipe quando todos têm relatório; não duplica; fatos saem dos relatórios", async () => {
    expect(await queueTeamVideos(db, org, NOW)).toBe(1);
    expect(await queueTeamVideos(db, org, NOW)).toBe(0);
    expect(await queueTeamVideos(db, other, NOW)).toBe(0);
    const [id] = await queuedTeamVideos(db, org);
    const store = createPgTeamVideoStore(db);
    const row = await store.get(org, id!);
    expect(row).toMatchObject({ teamId: team, week: "2026-W45", state: "queued", attempts: 0 });
    expect(await store.get(other, id!)).toBeNull();

    const got = await store.facts(org, team, "2026-W45");
    expect(got!.facts).toMatchObject({ teamName: "Produto", weekLabel: "2 a 6/11", deliveries: [{ ref: "echo/app#41", title: "Tela de pagamentos", personId: fer }], twins: { answered: 2, peopleIds: [fer] } });
    // Ajuda a quem é de fora da equipe não entra; o bonequinho gravado vale, e quem não tem, ganha traços estáveis.
    expect(got!.facts.helps).toEqual([{ fromId: car, toId: fer, count: 2 }]);
    expect(got!.facts.people.find((p) => p.id === car)!.avatar.hair).toBe("bun");
    expect(got!.candidates.map((c) => [c.pr.number, c.previewUrl])).toEqual([[41, "https://sha41.vercel.app"]]);

    expect(await store.transition(org, id!, "queued", "recording", { attempts: 1 })).toBe(true);
    expect(await store.transition(org, id!, "queued", "recording")).toBe(false);
    expect(await store.transition(org, id!, "recording", "ready", { storageKey: "file_1", durationS: 41, chapters: [{ at: 0, title: "a" }], costUsd: 0.3, expiresAt: new Date("2026-12-07T12:00:00Z"), story: { facts: got!.facts, texts: {}, scenes: [] } })).toBe(true);
    expect(await teamVideoForStream(db, org, id!)).toEqual({ storageKey: "file_1", teamId: team });
    expect(await teamVideoForStream(db, other, id!)).toBeNull();
    const [view] = await latestTeamVideos(db, org, [team]);
    expect(view).toMatchObject({ id, teamName: "Produto", weekLabel: "2 a 6/11", state: "ready", durationS: 41, playable: true });
    expect(await latestTeamVideos(db, other, [team])).toEqual([]);
    expect(await store.budget(org, new Date("2026-11-01T00:00:00Z"))).toEqual({ spentUsd: 0, monthlyLimitUsd: 50 });
  });

  it("gravação parada vira falha; vencido sai do armazenamento", async () => {
    const [stuck, old] = [randomUUID(), randomUUID()];
    await asSystem(sys(), (tx) =>
      tx.insert(teamVideos).values([
        { id: stuck, orgId: org, teamId: team, week: "2026-W43", state: "recording", updatedAt: new Date("2026-11-07T08:00:00Z") },
        { id: old, orgId: org, teamId: team, week: "2026-W42", state: "ready", storageKey: "file_old", expiresAt: new Date("2026-11-01T00:00:00Z") },
      ]),
    );
    expect(await failStuckTeamVideos(db, org, new Date("2026-11-07T11:00:00Z"))).toBe(1);
    expect(await expireTeamVideos(db, org, NOW)).toEqual(["file_old"]);
    expect(await expireTeamVideos(db, other, NOW)).toEqual([]);
  });
});
