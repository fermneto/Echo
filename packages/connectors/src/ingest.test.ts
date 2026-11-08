import { createDb, createPool, contributions, identities, inboxEvents, installationRoutes, orgs, people, pullRequests, tasks, workEvents } from "@echo/db";
import { InMemoryQueue, QUEUES } from "@echo/jobs";
import { and, eq } from "drizzle-orm";
import { appRoleUrl } from "@echo/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ghPr, ghPush, ghReview, linearIssue, slackEnvelope } from "./fixtures.ts";
import { processInbox, receive, type InboxJob } from "./inbox.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("ingest e caixa de entrada (Postgres real)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  // Código sob teste roda com um papel comum (sem BYPASSRLS) e sem o escopo de sistema:
  // fora de withOrg, as tabelas de negócio não devolvem nada.
  let appPool: ReturnType<typeof createPool>;
  let app: ReturnType<typeof createDb>;
  let orgId = "";
  const ids: Record<string, string> = {};
  const suffix = Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    appPool = createPool(await appRoleUrl(pool, url!), 2, { defaultScope: "none" });
    app = createDb(appPool);
    const [org] = await db.insert(orgs).values({ name: `Teste ingest ${suffix}` }).returning();
    orgId = org!.id;
    const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    for (const [key, name, tz] of [["fer", "Fernando", "America/Fortaleza"], ["car", "Carla", "America/Sao_Paulo"], ["bru", "Bruno", "America/Sao_Paulo"]] as const) {
      const [p] = await db.insert(people).values({ orgId, name, timezone: tz, workHours: wh }).returning();
      ids[key] = p!.id;
    }
    await db.insert(identities).values([
      { orgId, personId: ids.fer!, platform: "github", externalId: "101", login: "fernando-dev" },
      { orgId, personId: ids.car!, platform: "github", externalId: "102", login: "carla-dev" },
      { orgId, personId: ids.fer!, platform: "linear", externalId: "lin-user-fer" },
      { orgId, personId: ids.car!, platform: "jira", externalId: `acc-carla-${suffix}` },
      { orgId, personId: ids.car!, platform: "slack", externalId: `UCAR${suffix}` },
      { orgId, personId: ids.bru!, platform: "slack", externalId: `UBRU${suffix}` },
    ]);
    await db.insert(installationRoutes).values([
      { kind: "github", externalId: `555${suffix}`, orgId },
      { kind: "jira", externalId: `acme-${suffix}.atlassian.net`, orgId },
    ]);
  });

  afterAll(async () => {
    await db.delete(installationRoutes).where(eq(installationRoutes.orgId, orgId));
    await db.delete(inboxEvents).where(eq(inboxEvents.orgId, orgId));
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await Promise.all([pool.end(), appPool.end()]);
  });

  it("fora de withOrg, a conexão do código não enxerga nenhuma empresa", async () => {
    expect(await app.select().from(orgs)).toEqual([]);
    expect(await app.select().from(people)).toEqual([]);
  });

  const deliver = async (queue: InMemoryQueue, d: Parameters<typeof receive>[2]) => receive(app, queue, d);

  it("acha a empresa pela instalação, grava uma vez e o reenvio não duplica", async () => {
    const queue = new InMemoryQueue();
    const jobs: string[] = [];
    await queue.work<InboxJob>(QUEUES.inboxProcess, async (j) => void jobs.push(j.data.inboxId));
    const body = { ...ghPush(), installation: { id: `555${suffix}` } };
    const d = { source: "github" as const, deliveryId: `gh-${suffix}-1`, routeKey: `555${suffix}`, eventName: "push", payload: body };
    expect(await deliver(queue, d)).toBe("queued");
    expect(await deliver(queue, d)).toBe("duplicate");
    // Reenvio antes de processar volta para a fila, mas o singletonKey junta os dois num job só.
    expect(jobs).toHaveLength(1);
    await processInbox(app, jobs[0]!);
    const fresh = new InMemoryQueue();
    const after: string[] = [];
    await fresh.work<InboxJob>(QUEUES.inboxProcess, async (j) => void after.push(j.data.inboxId));
    expect(await deliver(fresh, d)).toBe("duplicate");
    expect(after).toHaveLength(0); // processado: não volta mais
    const rows = await db.select().from(inboxEvents).where(eq(inboxEvents.deliveryId, d.deliveryId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("processed");
  });

  it("instalação desconhecida é descartada", async () => {
    expect(await deliver(new InMemoryQueue(), { source: "github", deliveryId: `gh-${suffix}-x`, routeKey: "999999", eventName: "push", payload: ghPush() })).toBe("unrouted");
  });

  it("commit do autor ligado ganha pessoa; sem conta fica sem pessoa; coautor vira crédito", async () => {
    const commits = await db.select().from(workEvents).where(and(eq(workEvents.orgId, orgId), eq(workEvents.type, "commit")));
    const byRef = Object.fromEntries(commits.map((c) => [c.sourceRef, c]));
    expect(byRef["commit:a1b2c3"]!.personId).toBe(ids.fer); // login com maiúsculas diferentes
    expect(byRef["commit:d4e5f6"]!.personId).toBeNull();
    const credit = await db.select().from(contributions).where(and(eq(contributions.orgId, orgId), eq(contributions.kind, "coauthor")));
    expect(credit).toMatchObject([{ helperId: ids.car, helpedId: ids.fer, confirmed: true }]);
  });

  const run = async (source: "github" | "linear" | "jira" | "slack", eventName: string | undefined, payload: unknown, n: string) => {
    const queue = new InMemoryQueue();
    let inboxId = "";
    await queue.work<InboxJob>(QUEUES.inboxProcess, async (j) => void (inboxId = j.data.inboxId));
    await deliver(queue, { source, deliveryId: `${source}-${suffix}-${n}`, orgId, eventName, payload });
    return processInbox(app, inboxId, { slackBotUserId: "UBOT" });
  };

  it("push no repositório do espelho não é trabalho, mas pede sincronização das notas", async () => {
    const queue = new InMemoryQueue();
    let inboxId = "";
    await queue.work<InboxJob>(QUEUES.inboxProcess, async (j) => void (inboxId = j.data.inboxId));
    const body = { ...ghPush(), repository: { full_name: "Org-Teste/Brains" } };
    await deliver(queue, { source: "github", deliveryId: `gh-${suffix}-brains`, orgId, eventName: "push", payload: body });
    const before = (await db.select().from(workEvents).where(eq(workEvents.orgId, orgId))).length;
    const r = await processInbox(app, inboxId, { brainsRepository: "org-teste/brains" });
    expect(r?.brainsPush).toBe(true);
    expect(r?.applied).toBe(0);
    expect((await db.select().from(workEvents).where(eq(workEvents.orgId, orgId))).length).toBe(before);
  });

  it("PR fora de ordem não sobrescreve dado mais novo", async () => {
    await run("github", "pull_request", ghPr("opened", { updated_at: "2026-11-06T21:00:00Z" }), "pr1");
    await run("github", "pull_request", ghPr("closed", { state: "closed", merged: true, merged_at: "2026-11-07T10:00:00Z", updated_at: "2026-11-07T10:00:00Z" }), "pr2");
    await run("github", "pull_request", ghPr("synchronize", { updated_at: "2026-11-06T23:00:00Z" }), "pr3"); // atrasado
    const [pr] = await db.select().from(pullRequests).where(and(eq(pullRequests.orgId, orgId), eq(pullRequests.number, 42)));
    expect(pr).toMatchObject({ state: "merged", authorId: ids.fer, taskKey: "ECH-128", reviewerIds: [ids.car] });
  });

  it("revisão antes de um commit novo no PR aberto vira crédito de revisão atendida", async () => {
    await run("github", "pull_request", ghPr("reopened", { number: 43, head: { ref: "ech-140-api", sha: "z1" }, updated_at: "2026-11-07T11:00:00Z" }), "pr4");
    const review = ghReview(9100, "2026-11-07T11:30:00Z");
    review.pull_request = { ...review.pull_request, number: 43, head: { ref: "ech-140-api", sha: "z1" } };
    await run("github", "pull_request_review", review, "rv1");
    await run("github", "push", ghPush({ ref: "refs/heads/ech-140-api", commits: [{ id: "c9", message: "ajusta", timestamp: "2026-11-07T12:00:00Z", author: { username: "fernando-dev" } }] }), "push2");
    const credit = await db.select().from(contributions).where(and(eq(contributions.orgId, orgId), eq(contributions.kind, "review_change")));
    expect(credit).toMatchObject([{ helperId: ids.car, helpedId: ids.fer }]);
  });

  it("tarefa do Linear com responsável ligado; atualização velha não vence", async () => {
    await run("linear", undefined, linearIssue({ updatedAt: "2026-11-07T08:00:00Z" }), "l1");
    await run("linear", undefined, linearIssue({ title: "título velho", updatedAt: "2026-11-07T07:00:00Z" }), "l2");
    const [t] = await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.key, "ECH-128")));
    expect(t).toMatchObject({ title: "Tempo limite nos pagamentos", assigneeId: ids.fer, state: "in_progress", size: 3 });
  });

  it("Jira: acha a empresa pelo site, liga a pessoa pela conta do Jira e registra a conclusão uma vez", async () => {
    const issue = (status: { name: string; statusCategory: { key: string } }, updated: string) => ({
      id: `9${suffix.length}01`,
      key: "PAG-12",
      self: `https://acme-${suffix}.atlassian.net/rest/api/3/issue/9${suffix.length}01`,
      fields: { summary: "Conciliação diária", status, assignee: { accountId: `acc-carla-${suffix}` }, labels: [], components: [{ name: "pagamentos" }], customfield_10016: 2, updated, resolutiondate: status.statusCategory.key === "done" ? updated : null },
    });
    const queue = new InMemoryQueue();
    const ids2: string[] = [];
    await queue.work<InboxJob>(QUEUES.inboxProcess, async (j) => void ids2.push(j.data.inboxId));
    const first = issue({ name: "Em andamento", statusCategory: { key: "indeterminate" } }, "2026-11-07T10:00:00.000Z");
    expect(await deliver(queue, { source: "jira", deliveryId: `jira-${suffix}-1`, routeKey: `acme-${suffix}.atlassian.net`, payload: { webhookEvent: "jira:issue_created", issue: first } })).toBe("queued");
    await processInbox(app, ids2[0]!);
    const done = issue({ name: "Done", statusCategory: { key: "done" } }, "2026-11-07T12:00:00.000Z");
    await run("jira", undefined, { webhookEvent: "jira:issue_updated", issue: done, changelog: { items: [{ fieldId: "status" }] } }, "j2");
    await run("jira", undefined, { webhookEvent: "jira:issue_updated", issue: done, changelog: { items: [{ fieldId: "status" }] } }, "j3");
    const [t] = await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.key, "PAG-12")));
    expect(t).toMatchObject({ title: "Conciliação diária", assigneeId: ids.car, state: "done", size: 2, labels: ["pagamentos"] });
    const doneEvents = await db.select().from(workEvents).where(and(eq(workEvents.orgId, orgId), eq(workEvents.taskKey, "PAG-12")));
    expect(doneEvents).toMatchObject([{ type: "task_done", personId: ids.car, source: "jira" }]);
  });

  it("reação de ajuda registra só a referência; mensagem segue para o F2 e o texto não fica guardado", async () => {
    await run("slack", undefined, slackEnvelope({ type: "reaction_added", user: `UBRU${suffix}`, reaction: "pray", item_user: `UCAR${suffix}`, item: { type: "message", channel: "C1", ts: "5.5" }, event_ts: "1762500000.1" }), "s1");
    const [c] = await db.select().from(contributions).where(and(eq(contributions.orgId, orgId), eq(contributions.kind, "reaction")));
    expect(c).toMatchObject({ helperId: ids.car, helpedId: ids.bru, sourceRef: "C1:5.5" });

    const result = await run("slack", undefined, slackEnvelope({ type: "app_mention", text: "<@UBOT> quem está livre?", user: `UCAR${suffix}`, channel: "C1", ts: "6.6" }, "Ev2"), "s2");
    expect(result!.messages[0]).toMatchObject({ text: "<@UBOT> quem está livre?", mentionsBot: true });
    const [row] = await db.select().from(inboxEvents).where(eq(inboxEvents.deliveryId, `slack-${suffix}-s2`));
    expect(JSON.stringify(row!.payload)).not.toContain("quem está livre");
  });
});
