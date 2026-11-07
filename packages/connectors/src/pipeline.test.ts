import { createDb, createPool, deployments, orgs, pullRequests } from "@echo/db";
import { appRoleUrl } from "@echo/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checksStateOf, normalizeGithub } from "./github.ts";
import { ingest } from "./ingest.ts";
import { ciStatus, deployStatus, type LiveChecks } from "./pipeline.ts";
import { normalizeVercel, signVercel, verifyVercel } from "./vercel.ts";

const suite = (conclusion: string, sha = "abc123", prs = [42]) => ({
  action: "completed",
  repository: { full_name: "org-teste/app" },
  check_suite: { head_sha: sha, conclusion, updated_at: "2026-11-07T02:48:00Z", pull_requests: prs.map((number) => ({ number })) },
});
const vercel = (type: string, over: Record<string, unknown> = {}, target: string | null = null, id = "dpl_1") => ({
  id: `evt_${type}_${id}`,
  type,
  createdAt: Date.parse("2026-11-07T03:00:00Z"),
  payload: {
    team: { id: "team_x" },
    target,
    deployment: { id, url: "app-git-ech-128.vercel.app", meta: { githubCommitSha: "abc123", githubCommitRef: "ech-128-tempo-limite", githubRepo: "app", githubOrg: "org-teste" }, ...over },
  },
});

describe("normalização de CI/CD", () => {
  it("check_suite concluída vira estado dos checks do PR, só com o link", () => {
    expect(normalizeGithub("check_suite", suite("success"))[0]).toMatchObject({
      kind: "checks",
      headSha: "abc123",
      prNumbers: [42],
      state: "success",
      url: "https://github.com/org-teste/app/commit/abc123/checks",
    });
    expect(normalizeGithub("check_suite", suite("success", "x", []))[0]!.kind).toBe("ignored");
    expect(["success", "failure", "timed_out", "skipped", null].map(checksStateOf)).toEqual(["success", "failure", "failure", "neutral", "pending"]);
  });

  it("deploy da Vercel com ambiente, commit e link; assinatura HMAC-SHA1", () => {
    expect(normalizeVercel(vercel("deployment.succeeded"))[0]).toMatchObject({
      kind: "deployment",
      deployment: { provider: "vercel", externalId: "dpl_1", repository: "org-teste/app", sha: "abc123", branch: "ech-128-tempo-limite", environment: "preview", state: "ready", url: "https://app-git-ech-128.vercel.app" },
    });
    expect(normalizeVercel(vercel("deployment.error", {}, "production"))[0]).toMatchObject({ deployment: { environment: "production", state: "error" } });
    expect(normalizeVercel({ type: "project.created" })[0]!.kind).toBe("ignored");
    const body = JSON.stringify(vercel("deployment.created"));
    expect(verifyVercel("sec", body, signVercel("sec", body)).ok).toBe(true);
    expect(verifyVercel("sec", body + " ", signVercel("sec", body)).ok).toBe(false);
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("checks, deploys e status (Postgres real, papel comum)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  let appPool: ReturnType<typeof createPool>;
  let app: ReturnType<typeof createDb>;
  let orgId = "";
  beforeAll(async () => {
    appPool = createPool(await appRoleUrl(pool, url!), 2, { defaultScope: "none" });
    app = createDb(appPool);
    const [org] = await db.insert(orgs).values({ name: `Teste CI ${Math.random().toString(36).slice(2, 7)}` }).returning();
    orgId = org!.id;
    await db.insert(pullRequests).values([
      { orgId, repository: "org-teste/app", number: 42, title: "ECH-128", state: "open", branch: "ech-128-tempo-limite", headSha: "abc123" },
      { orgId, repository: "org-teste/app", number: 41, title: "ECH-120", state: "merged", branch: "ech-120", headSha: "zzz", mergedAt: new Date("2026-11-06T22:00:00Z") },
    ]);
  });
  afterAll(async () => {
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await Promise.all([pool.end(), appPool.end()]);
  });

  it("checks do commit atual atualizam o PR; aviso de commit antigo ou atrasado não sobrescreve", async () => {
    await ingest(app, orgId, normalizeGithub("check_suite", suite("failure")));
    await ingest(app, orgId, normalizeGithub("check_suite", suite("success", "commit-antigo")));
    const late = suite("success");
    late.check_suite.updated_at = "2026-11-07T01:00:00Z";
    await ingest(app, orgId, normalizeGithub("check_suite", late));
    const [pr] = await db.select().from(pullRequests).where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.number, 42)));
    expect(pr).toMatchObject({ checksState: "failure", checksUrl: "https://github.com/org-teste/app/commit/abc123/checks" });
  });

  it("ciStatus: ao vivo quando o GitHub responde; senão o último aviso, marcado como não ao vivo", async () => {
    const live: LiveChecks = { getChecks: async () => ({ state: "success", total: 3, failed: [], running: 0, url: "https://github.com/x/checks" }) };
    expect(await ciStatus(app, orgId, "org-teste/app", 42, live)).toMatchObject({ state: "success", live: true });
    const down: LiveChecks = { getChecks: async () => Promise.reject(new Error("GitHub fora")) };
    expect(await ciStatus(app, orgId, "org-teste/app", 42, down)).toMatchObject({ state: "failure", live: false });
    expect(await ciStatus(app, orgId, "org-teste/app", 999)).toBeNull();
  });

  it("deploys: preview do PR aberto; produção só depois do merge; aviso atrasado não volta o estado", async () => {
    await ingest(app, orgId, normalizeVercel(vercel("deployment.succeeded")));
    await ingest(app, orgId, normalizeVercel({ ...vercel("deployment.created"), createdAt: Date.parse("2026-11-07T02:00:00Z") })); // atrasado
    const [d] = await db.select().from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.externalId, "dpl_1")));
    expect(d!.state).toBe("ready");
    expect(await deployStatus(app, orgId, "org-teste/app", 42)).toMatchObject({ merged: false, inProduction: false, preview: { state: "ready" }, production: null });

    // Produção do commit de merge do PR 41, depois do merge.
    await ingest(app, orgId, normalizeVercel(vercel("deployment.succeeded", { meta: { githubCommitSha: "merge41", githubCommitRef: "main", githubRepo: "app", githubOrg: "org-teste" } }, "production", "dpl_prod")));
    expect(await deployStatus(app, orgId, "org-teste/app", 41)).toMatchObject({ merged: true, inProduction: true, production: { state: "ready" } });
  });
});
