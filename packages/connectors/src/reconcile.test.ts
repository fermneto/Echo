import { createDb, createPool, identities, orgs, people, pullRequests, tasks, workEvents } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { appRoleUrl } from "@echo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GhCommit } from "./github.ts";
import { normalizeLinear } from "./linear.ts";
import { ingest } from "./ingest.ts";
import { linearIssue } from "./fixtures.ts";
import type { ExternalPullRequest, ExternalTask, LivePullRequest } from "./normalized.ts";
import { openPullRequestNumbers, reconcileGithub, reconcileLinear, type GithubReconciler, type LinearReconciler } from "./reconcile.ts";

const url = process.env.DATABASE_URL;
const NOW = new Date("2026-11-07T15:00:00Z");
const REPO = "org-teste/app";

const pr = (number: number, over: Partial<LivePullRequest> = {}): LivePullRequest => ({
  repository: REPO,
  number,
  title: `ECH-${number}: mudança`,
  author: { platform: "github", login: "fernando-dev" },
  state: "open",
  branch: `ech-${number}-x`,
  taskKey: `ECH-${number}`,
  reviewers: [],
  openedAt: new Date("2026-11-05T10:00:00Z"),
  updatedAt: new Date("2026-11-06T10:00:00Z"),
  files: [`src/f${number}.ts`],
  mergeable: true,
  ...over,
});

/** GitHub falso: lista de PRs abertos e PRs ao vivo controláveis; conta as consultas. */
function fakeGithub(state: { open: ExternalPullRequest[]; live: Record<number, LivePullRequest | null>; commits: GhCommit[]; failRepo?: string }) {
  const calls = { live: [] as number[] };
  const gh: GithubReconciler = {
    listRepositories: async () => [REPO, "org-teste/brains", ...(state.failRepo ? [state.failRepo] : [])],
    listCommitsSince: async (repo) => {
      if (repo === state.failRepo) throw new Error("GitHub 500");
      return repo === REPO ? state.commits : [];
    },
    listOpenPullRequests: async (repo) => (repo === REPO ? state.open : []),
    getPullRequest: async (_r, n) => (calls.live.push(n), state.live[n] ?? null),
    findPullRequestByBranch: async () => null,
    getLastCommitAt: async () => null,
  };
  return { gh, calls };
}

describe.skipIf(!url)("reconciliação (Postgres real)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  // Código sob teste roda com um papel comum (sem BYPASSRLS) e sem o escopo de sistema:
  // fora de withOrg, as tabelas de negócio não devolvem nada.
  let appPool: ReturnType<typeof createPool>;
  let app: ReturnType<typeof createDb>;
  let orgId = "";
  let fer = "";

  beforeAll(async () => {
    appPool = createPool(await appRoleUrl(pool, url!), 2, { defaultScope: "none" });
    app = createDb(appPool);
    const [org] = await db.insert(orgs).values({ name: `Teste reconciliação ${Math.random().toString(36).slice(2, 7)}` }).returning();
    orgId = org!.id;
    const [p] = await db.insert(people).values({ orgId, name: "Fernando", timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } }).returning();
    fer = p!.id;
    await db.insert(identities).values([
      { orgId, personId: fer, platform: "github", externalId: "101", login: "fernando-dev" },
      { orgId, personId: fer, platform: "linear", externalId: "lin-user-fer" },
    ]);
  });
  afterAll(async () => {
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await Promise.all([pool.end(), appPool.end()]);
  });

  const commits: GhCommit[] = [{ id: "rc1", message: "ECH-41: ajuste", timestamp: "2026-11-06T12:00:00Z", author: { username: "Fernando-Dev" } }];

  it("importa commits e PRs abertos, com arquivos, ignorando o repositório do espelho", async () => {
    const { gh, calls } = fakeGithub({ open: [pr(41), pr(42)], live: { 41: pr(41), 42: pr(42) }, commits });
    const r = await reconcileGithub(app, orgId, gh, NOW, { brainsRepository: "org-teste/brains" });
    expect(r).toMatchObject({ repositories: 1, commits: 1, openPrs: 2, detailed: 2, closedSinceLastRun: 0, errors: [] });
    expect(calls.live.sort()).toEqual([41, 42]);
    const [row] = await db.select().from(pullRequests).where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.number, 41)));
    expect(row).toMatchObject({ state: "open", files: ["src/f41.ts"], authorId: fer });
    const [c] = await db.select().from(workEvents).where(and(eq(workEvents.orgId, orgId), eq(workEvents.sourceRef, "commit:rc1")));
    expect(c).toMatchObject({ personId: fer, taskKey: "ECH-41" });
  });

  it("rodar de novo sem mudanças não duplica nem consulta detalhes outra vez", async () => {
    const { gh, calls } = fakeGithub({ open: [pr(41), pr(42)], live: {}, commits });
    const r = await reconcileGithub(app, orgId, gh, NOW);
    expect(r.detailed).toBe(0);
    expect(calls.live).toEqual([]);
    const all = await db.select().from(workEvents).where(and(eq(workEvents.orgId, orgId), eq(workEvents.sourceRef, "commit:rc1")));
    expect(all).toHaveLength(1);
  });

  it("PR que saiu da lista de abertos sem aviso é consultado e fechado; unido vira pr_merged", async () => {
    const merged = pr(42, { state: "merged", mergedAt: new Date("2026-11-07T09:00:00Z"), updatedAt: new Date("2026-11-07T09:00:00Z") });
    const { gh } = fakeGithub({ open: [pr(41)], live: { 42: merged }, commits: [] });
    const r = await reconcileGithub(app, orgId, gh, NOW);
    expect(r.closedSinceLastRun).toBe(1);
    expect(await openPullRequestNumbers(app, orgId, REPO)).toEqual([41]);
    const [m] = await db.select().from(workEvents).where(and(eq(workEvents.orgId, orgId), eq(workEvents.type, "pr_merged")));
    expect(m).toMatchObject({ prNumber: 42, personId: fer, taskKey: "ECH-42" });
  });

  it("falha num repositório não impede os outros e volta no resultado", async () => {
    const { gh } = fakeGithub({ open: [pr(41)], live: {}, commits: [], failRepo: "org-teste/quebrado" });
    const r = await reconcileGithub(app, orgId, gh, NOW, { brainsRepository: "org-teste/brains" });
    expect(r.errors).toEqual(["org-teste/quebrado: GitHub 500"]);
    expect(r.repositories).toBe(2);
  });

  const task = (key: string, over: Partial<ExternalTask> = {}): ExternalTask => ({
    key,
    source: "linear",
    linearId: `lin-${key}`,
    title: key,
    assignee: { platform: "linear", externalId: "lin-user-fer" },
    state: "in_progress",
    labels: [],
    updatedAt: new Date("2026-11-07T08:00:00Z"),
    ...over,
  });

  it("Linear: abertas e encerradas em 7 dias; conclusão não duplica com a que veio por aviso", async () => {
    // A conclusão de ECH-200 já chegou por aviso.
    const done = normalizeLinear({ ...linearIssue({ id: "lin-ECH-200", identifier: "ECH-200", state: { type: "completed", name: "Done" }, completedAt: "2026-11-07T07:00:00Z", updatedAt: "2026-11-07T07:00:00Z" }), updatedFrom: { stateId: "x" } });
    await ingest(app, orgId, done);
    const linear: LinearReconciler = {
      listOpenTasks: async () => ({ tasks: [task("ECH-201"), task("ECH-202", { assignee: undefined })], truncated: false }),
      listClosedTasksSince: async () => ({ tasks: [task("ECH-200", { state: "done", completedAt: new Date("2026-11-07T07:00:00Z") })], truncated: false }),
      getTask: async () => null,
    };
    expect(await reconcileLinear(app, orgId, linear, NOW)).toEqual({ open: 2, closed: 1, truncated: false });
    expect(await reconcileLinear(app, orgId, linear, NOW)).toEqual({ open: 2, closed: 1, truncated: false });
    const rows = await db.select().from(tasks).where(eq(tasks.orgId, orgId));
    expect(Object.fromEntries(rows.map((t) => [t.key, t.assigneeId]))).toMatchObject({ "ECH-201": fer, "ECH-202": null });
    const doneEvents = await db.select().from(workEvents).where(and(eq(workEvents.orgId, orgId), eq(workEvents.type, "task_done")));
    expect(doneEvents).toHaveLength(1);
  });
});
