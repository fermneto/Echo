// Simula as plataformas: manda à API avisos assinados com os segredos do .env, como se viessem do GitHub,
// do Linear, do Slack e da Vercel, e confere que cada um foi gravado, processado e sem duplicar.
// Valida API + worker + banco antes de ligar cada plataforma. Não chama nenhuma plataforma real.
// Uso: pnpm integracoes:simular [--limpar]     (API e worker no ar; ver docs/integracoes/ambiente.md)
import { randomUUID } from "node:crypto";
import { asSystem, contributions, createDb, createPool, deployments, identities, inboxEvents, installationRoutes, orgs, people, tasks, withOrg, workEvents } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { dropInactiveTrackerRoute, orgActiveTracker } from "./platforms.ts";
import { sign } from "./signatures.ts";
import { signVercel } from "./vercel.ts";

const env = process.env;
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};
if (!env.DATABASE_URL) fail("DATABASE_URL ausente no .env.");
const api = (env.API_PUBLIC_URL || `http://localhost:${env.API_PORT ?? 3001}`).replace(/\/$/, "");
const pool = createPool(env.DATABASE_URL!, 2, { defaultScope: "system" });
const db = createDb(pool);
const ORG_NAME = "Simulação de integrações";
const R = { github: "sim-installation-555", slack: "T_SIMULACAO", linear: "sim-linear-org", vercel: "team_simulacao" };

// ---------------------------------------------------------------- limpeza
if (process.argv.includes("--limpar")) {
  await asSystem(db, async (tx) => {
    const [o] = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.name, ORG_NAME));
    if (o) {
      await tx.delete(installationRoutes).where(eq(installationRoutes.orgId, o.id));
      await tx.delete(inboxEvents).where(eq(inboxEvents.orgId, o.id));
      await tx.delete(orgs).where(eq(orgs.id, o.id));
    }
  });
  console.log("Empresa de simulação removida.");
  await pool.end();
  process.exit(0);
}

// ---------------------------------------------------------------- empresa sintética
const orgId = await asSystem(db, async (tx) => {
  const [found] = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.name, ORG_NAME));
  const id = found?.id ?? (await tx.insert(orgs).values({ name: ORG_NAME, isDemo: true }).returning({ id: orgs.id }))[0]!.id;
  for (const [kind, externalId] of Object.entries(R)) {
    await tx.insert(installationRoutes).values({ kind, externalId, orgId: id }).onConflictDoUpdate({ target: [installationRoutes.kind, installationRoutes.externalId], set: { orgId: id } });
  }
  // Um tracker por vez: a simulação fala pelo Linear, então uma rota do Jira que tenha ficado nesta empresa sai.
  await dropInactiveTrackerRoute(tx, id, await orgActiveTracker(tx, id));
  return id;
});
const ids = await withOrg(db, orgId, async (tx) => {
  const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  const out: Record<string, string> = {};
  for (const [key, name, slack, gh, lin] of [["ana", "Ana Simulada", "U_SIM_ANA", "ana-simulada", "sim-lin-ana"], ["beto", "Beto Simulado", "U_SIM_BETO", "beto-simulado", "sim-lin-beto"]] as const) {
    let [p] = await tx.select({ id: people.id }).from(people).where(and(eq(people.orgId, orgId), eq(people.name, name)));
    if (!p) [p] = await tx.insert(people).values({ orgId, name, timezone: "America/Sao_Paulo", workHours: wh }).returning({ id: people.id });
    out[key] = p!.id;
    for (const [platform, externalId, login] of [["slack", slack, null], ["github", `login:${gh}`, gh], ["linear", lin, null]] as const) {
      await tx.insert(identities).values({ orgId, personId: p!.id, platform, externalId, login }).onConflictDoNothing();
    }
  }
  return out;
});
console.log(`Empresa de simulação: ${orgId}\nAPI: ${api}\n`);

// ---------------------------------------------------------------- envio e conferência
type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const post = (path: string, body: string, headers: Record<string, string>) =>
  fetch(`${api}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, signal: AbortSignal.timeout(10_000) })
    .then((r) => r.status)
    .catch((e) => fail(`A API não respondeu em ${api} (${e instanceof Error ? e.message : e}). Suba com pnpm --filter @echo/api dev.`));

/** Espera o aviso ser processado pelo worker e o efeito aparecer no banco. */
async function waitFor<T>(check: () => Promise<T | undefined | null | false>, ms = 20_000): Promise<T | null> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 1_000))) {
    const v = await check();
    if (v) return v;
  }
  return null;
}
const inboxState = async (source: string, deliveryId: string) =>
  (await withOrg(db, orgId, (tx) => tx.select({ state: inboxEvents.state }).from(inboxEvents).where(and(eq(inboxEvents.source, source), eq(inboxEvents.deliveryId, deliveryId)))))[0]?.state;

async function scenario(name: string, secretKey: string, send: (secret: string, deliveryId: string) => Promise<number>, bad: (deliveryId: string) => Promise<number>, source: string, effect: () => Promise<string | null>) {
  const secret = env[secretKey];
  if (!secret) {
    results.push({ name, ok: false, detail: `pulado: ${secretKey} ausente no .env (a API responde 503 sem ele)` });
    return;
  }
  const deliveryId = `sim-${randomUUID()}`;
  const s1 = await send(secret, deliveryId);
  const s2 = await send(secret, deliveryId); // reenvio do mesmo aviso
  const sBad = await bad(`sim-ruim-${randomUUID()}`);
  if (s1 !== 200) return void results.push({ name, ok: false, detail: `a API respondeu ${s1} (esperado 200). Confira se ${secretKey} da API é o mesmo deste .env` });
  const processed = await waitFor(async () => {
    const st = await inboxState(source, deliveryId);
    return st && st !== "received" ? st : null;
  });
  if (!processed) {
    const st = await inboxState(source, deliveryId);
    return void results.push({ name, ok: false, detail: st ? `gravado, mas não processado em 20 s: o worker está no ar? (pnpm --filter @echo/worker dev)` : "a API respondeu 200, mas nada foi gravado: a rota da empresa não bateu" });
  }
  const what = await waitFor(effect, 5_000);
  const rows = (await withOrg(db, orgId, (tx) => tx.select({ id: inboxEvents.id }).from(inboxEvents).where(and(eq(inboxEvents.source, source), eq(inboxEvents.deliveryId, deliveryId))))).length;
  const problems = [
    ...(processed === "failed" ? ["o processamento falhou (veja inbox_events.error)"] : []),
    ...(what ? [] : ["o efeito esperado não apareceu no banco"]),
    ...(s2 === 200 && rows === 1 ? [] : [`reenvio: resposta ${s2}, ${rows} linhas (esperado 200 e 1)`]),
    ...(sBad === 401 ? [] : [`assinatura errada respondeu ${sBad} (esperado 401)`]),
  ];
  results.push({ name, ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `${what}; reenvio sem duplicar; assinatura errada → 401` });
}

const now = new Date();
const sha = randomUUID().replace(/-/g, "").slice(0, 12);

await scenario(
  "GitHub: push vira commit da pessoa certa",
  "GITHUB_WEBHOOK_SECRET",
  (secret, d) => {
    const body = JSON.stringify({ ref: "refs/heads/sim-1-teste", installation: { id: R.github }, repository: { full_name: "simulacao/app" }, commits: [{ id: sha, message: "SIM-1: simulação", timestamp: now.toISOString(), author: { username: "Ana-Simulada" } }] });
    return post("/webhooks/github", body, { ...sign.github(secret, body), "x-github-event": "push", "x-github-delivery": d });
  },
  (d) => post("/webhooks/github", "{}", { "x-hub-signature-256": "sha256=00", "x-github-event": "push", "x-github-delivery": d }),
  "github",
  async () => {
    const [e] = await withOrg(db, orgId, (tx) => tx.select().from(workEvents).where(and(eq(workEvents.orgId, orgId), eq(workEvents.sourceRef, `commit:${sha}`))));
    return e?.personId === ids.ana ? "commit gravado com a pessoa e a tarefa SIM-1" : null;
  },
);

const issueId = `sim-issue-${sha}`;
await scenario(
  "Linear: tarefa chega com o responsável certo",
  "LINEAR_WEBHOOK_SECRET",
  (secret, d) => {
    const body = JSON.stringify({ action: "create", type: "Issue", organizationId: R.linear, createdAt: now.toISOString(), webhookTimestamp: Date.now(), data: { id: issueId, identifier: `SIM-${sha.slice(0, 4)}`, title: "Tarefa simulada", assigneeId: "sim-lin-ana", state: { type: "started", name: "In Progress" }, labels: [], updatedAt: now.toISOString() } });
    return post("/webhooks/linear", body, { ...sign.linear(secret, body), "linear-delivery": d });
  },
  (d) => post("/webhooks/linear", JSON.stringify({ webhookTimestamp: Date.now() }), { "linear-signature": "00", "linear-delivery": d }),
  "linear",
  async () => {
    const [t] = await withOrg(db, orgId, (tx) => tx.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.linearId, issueId))));
    return t && t.assigneeId === ids.ana ? `tarefa ${t.key} em andamento, com a Ana` : null;
  },
);

const msgTs = `${Math.floor(Date.now() / 1000)}.${sha.slice(0, 6)}`;
await scenario(
  "Slack: reação 🙏 vira ajuda confirmada, sem texto",
  "SLACK_SIGNING_SECRET",
  (secret, d) => {
    const body = JSON.stringify({ type: "event_callback", team_id: R.slack, event_id: d, authorizations: [{ user_id: "U_SIM_BOT", is_bot: true }], event: { type: "reaction_added", user: "U_SIM_BETO", reaction: "pray", item_user: "U_SIM_ANA", item: { type: "message", channel: "C_SIM", ts: msgTs }, event_ts: String(Date.now() / 1000) } });
    return post("/webhooks/slack", body, sign.slack(secret, body, Math.floor(Date.now() / 1000)));
  },
  (d) => post("/webhooks/slack", JSON.stringify({ type: "event_callback", event_id: d }), { "x-slack-request-timestamp": String(Math.floor(Date.now() / 1000)), "x-slack-signature": "v0=00" }),
  "slack",
  async () => {
    const [c] = await withOrg(db, orgId, (tx) => tx.select().from(contributions).where(and(eq(contributions.orgId, orgId), eq(contributions.sourceRef, `C_SIM:${msgTs}`))));
    return c && c.helperId === ids.ana && c.helpedId === ids.beto ? "ajuda da Ana ao Beto registrada só com a referência" : null;
  },
);

const deployId = `dpl_sim_${sha}`;
await scenario(
  "Vercel: deploy de preview registrado",
  "VERCEL_WEBHOOK_SECRET",
  (secret, d) => {
    const body = JSON.stringify({ id: d, type: "deployment.succeeded", createdAt: Date.now(), payload: { team: { id: R.vercel }, target: null, deployment: { id: deployId, url: "simulacao-git-sim-1.vercel.app", meta: { githubCommitSha: sha, githubCommitRef: "sim-1-teste", githubRepo: "app", githubOrg: "simulacao" } } } });
    return post("/webhooks/vercel", body, signVercel(secret, body));
  },
  (d) => post("/webhooks/vercel", JSON.stringify({ id: d, type: "deployment.created" }), { "x-vercel-signature": "00" }),
  "vercel",
  async () => {
    const [dep] = await withOrg(db, orgId, (tx) => tx.select().from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.externalId, deployId))));
    return dep?.state === "ready" ? "preview pronto, ligado ao commit e à branch" : null;
  },
);

await pool.end();
for (const r of results) console.log(`${r.ok ? "✔" : r.detail.startsWith("pulado") ? "•" : "✘"} ${r.name}\n    ${r.detail}`);
const failed = results.filter((r) => !r.ok && !r.detail.startsWith("pulado"));
console.log(`\n${results.filter((r) => r.ok).length} ok · ${failed.length} com problema · ${results.length - results.filter((r) => r.ok).length - failed.length} pulados.`);
console.log("Para apagar a empresa de simulação: pnpm integracoes:simular --limpar");
process.exitCode = failed.length ? 1 : 0;
