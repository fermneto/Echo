// Aplicar no PR de ponta a ponta, contra o Postgres real (DATABASE_URL) e o cliente do GitHub com fetch simulado:
// clique do Slack → roteador único → decide → github.merge_fix aprovado no outbox → executor → POST /merges → sync.
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { drainActions } from "@echo/actions";
import { serverEndOfDay, serverFix } from "@echo/agents/server";
import { FIX_DECISION_TEXT } from "@echo/agents";
import { GithubApp } from "@echo/connectors";
import { agentRuns, asSystem, createDb, createPool, type Database, fixRuns, identities, orgs, outboxActions, people, pullRequests, reviews, teams } from "@echo/db";
import { and, eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixInteractionHandler } from "./fix.ts";
import { handleSlackInteraction } from "./slack-answer.ts";
import { createInteractionRouter } from "./slack-interactions.ts";

const url = process.env.DATABASE_URL;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

describe.skipIf(!url)("Aplicar no PR de ponta a ponta", () => {
  let pool: ReturnType<typeof createPool>;
  let db: Database;
  const org = randomUUID();
  const team = randomUUID();
  const fer = randomUUID();
  const edu = randomUUID();
  const pr = randomUUID();
  const review = randomUUID();
  const fixId = randomUUID();
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values({ id: org, name: "Verificar união" });
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto", loadLimit: 10 });
      await tx.insert(people).values([
        { id: fer, orgId: org, teamId: team, name: "Fernando Neto", role: "member", timezone: "America/Fortaleza", workHours: hours },
        { id: edu, orgId: org, teamId: team, name: "Eduardo", role: "member", timezone: "America/Fortaleza", workHours: hours },
      ]);
      await tx.insert(identities).values([
        { orgId: org, personId: fer, platform: "slack", externalId: "UFER" },
        { orgId: org, personId: edu, platform: "slack", externalId: "UEDU" },
      ]);
      await tx.insert(pullRequests).values({ id: pr, orgId: org, repository: "DemoEcho/app", number: 1, title: "Tempo limite", authorId: fer, state: "open", branch: "cliente-http-tempo-limite", headSha: "pr1" });
      await tx.insert(reviews).values({ id: review, orgId: org, prId: pr, headSha: "pr1", state: "fix_ready", model: "claude-sonnet-5-5", files: ["src/http.ts"], findings: [] });
      await tx.insert(fixRuns).values({ id: fixId, orgId: org, reviewId: review, state: "ready", branch: "echo/fix-pr-1", baseSha: "pr1", draftPrNumber: 2, draftHeadSha: "d2", files: ["src/http.ts"] });
    });
  });
  afterAll(async () => {
    if (db) await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await pool?.end();
  });

  it("clique → aprovado → /merges → aplicada", async () => {
    // PR à frente do rascunho (sha "pr1-novo"); o rascunho segue em d2.
    const merges: unknown[] = [];
    let mergeStatus = 201;
    const fetch = async (u: string, init: RequestInit) => {
      const path = new URL(u).pathname;
      const m = init.method ?? "GET";
      if (m === "POST" && path === "/app/installations/9/access_tokens") return Response.json({ token: "ghs_x", expires_at: "2099-01-01T00:00:00Z" });
      if (m === "GET" && path === "/repos/DemoEcho/app/pulls/1") return Response.json({ state: "open", head: { sha: "pr1-novo" } });
      if (m === "GET" && path === "/repos/DemoEcho/app/pulls/2") return Response.json({ state: "open", draft: true, head: { sha: "d2" } });
      if (m === "POST" && path === "/repos/DemoEcho/app/merges") {
        merges.push(JSON.parse(String(init.body)));
        return mergeStatus === 204 ? new Response(null, { status: 204 }) : Response.json({ sha: "merge1" }, { status: mergeStatus });
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    };
    const gh = new GithubApp({ appId: "1", privateKey, fetch: fetch as typeof globalThis.fetch }).forInstallation("9");
    const fix = serverFix(db, { codeHost: async () => gh });
    const log = pino({ level: "silent" });
    const responses: { url: string; body: unknown }[] = [];
    const router = createInteractionRouter(log);
    router.add("resolveu", (job) => handleSlackInteraction({ db, log, respond: async (u, b) => void responses.push({ url: u, body: b }) }, job as never));
    const eod = serverEndOfDay(db, undefined, "http://localhost:3000");
    router.add("nota-do-dia", async (job) => (await eod.confirmFromSlack(job.orgId, job.payload)) ?? "ignored");
    router.add("correcao", fixInteractionHandler({ fix, log, respond: async (u, b) => void responses.push({ url: u, body: b }) }));
    const click = (user: string, action_id: string, extra: Record<string, unknown> = {}) => ({
      type: "block_actions",
      team: { id: "T1" },
      user: { id: user },
      response_url: "https://hooks.slack.com/actions/x",
      actions: [{ action_id, block_id: "b", type: "button", action_ts: "1", ...extra }],
    });

    // (b) Ver o rascunho: botão de link, sem value. Ninguém trata nem falha.
    await router.dispatch({ orgId: org, payload: click("UFER", "correcao_ver", { url: "https://github.com/DemoEcho/app/pull/2" }) });
    expect(responses).toEqual([]);
    // Outra pessoa não aplica.
    await router.dispatch({ orgId: org, payload: click("UEDU", "correcao_aplicar", { value: fixId }) });
    expect(responses.at(-1)!.body).toMatchObject({ response_type: "ephemeral", text: FIX_DECISION_TEXT.denied });
    // (e) O autor aplica: confere d2 do rascunho, mesmo com o PR à frente.
    await router.dispatch({ orgId: org, payload: click("UFER", "correcao_aplicar", { value: fixId }) });
    expect(responses.at(-1)!.body).toEqual({ replace_original: true, text: FIX_DECISION_TEXT.approved });
    const [a] = await asSystem(db, (tx) => tx.select().from(outboxActions).where(and(eq(outboxActions.orgId, org), eq(outboxActions.type, "github.merge_fix"))));
    expect(a).toMatchObject({ state: "approved", approvedBy: fer, payload: { repo: "DemoEcho/app", number: 2, sha: "d2", base: "cliente-http-tempo-limite", prNumber: 1 } });

    // (d) Executor real com o cliente do GitHub: POST /merges base = branch do PR, head = sha do rascunho.
    expect(await drainActions({ db, writers: async () => ({ code: gh }) }, org)).toEqual({ done: 1, failed: 0, retried: 0 });
    expect(merges).toEqual([{ base: "cliente-http-tempo-limite", head: "d2", commit_message: "Correção do Echo (#2) aprovada pelo autor do PR #1" }]);
    // (c) sync marca aplicada.
    expect(await fix.sync(org)).toEqual({ ready: 0, applied: 1, failed: 0 });
    const [f] = await asSystem(db, (tx) => tx.select().from(fixRuns).where(eq(fixRuns.id, fixId)));
    expect(f).toMatchObject({ state: "applied", decidedBy: fer });
    const [rv] = await asSystem(db, (tx) => tx.select().from(reviews).where(eq(reviews.id, review)));
    expect(rv!.state).toBe("applied");
    // Clique atrasado depois de aplicada: já decidida (não "o rascunho mudou"), sem outra união.
    await router.dispatch({ orgId: org, payload: click("UFER", "correcao_aplicar", { value: fixId }) });
    expect(responses.at(-1)!.body).toEqual({ replace_original: false, response_type: "ephemeral", text: FIX_DECISION_TEXT.conflict });
    expect(await asSystem(db, (tx) => tx.select().from(outboxActions).where(and(eq(outboxActions.orgId, org), eq(outboxActions.type, "github.merge_fix"))))).toHaveLength(1);
    const runs = await asSystem(db, (tx) => tx.select().from(agentRuns).where(eq(agentRuns.orgId, org)));
    expect(runs.map((r) => r.flow).sort()).toEqual(["fix_applied", "fix_decision", "fix_decision", "fix_decision"]);

    // 204 (já unido) e 409 (conflito), com o cliente real.
    mergeStatus = 204;
    expect(await gh.mergeFix({ repo: "DemoEcho/app", base: "cliente-http-tempo-limite", sha: "d2", message: "m" })).toEqual({ sha: null });
    mergeStatus = 409;
    await expect(gh.mergeFix({ repo: "DemoEcho/app", base: "cliente-http-tempo-limite", sha: "d2", message: "m" })).rejects.toMatchObject({ status: 409 });
  });
});
