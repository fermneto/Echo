import { serve } from "@hono/node-server";
import { listenPort, loadConfig } from "@echo/config";
import { applyHrEvent, hrSecret, receive, routeOrg, TokenCipher } from "@echo/connectors";
import { createDb, createPool, identities, ping } from "@echo/db";
import { PgBossQueue, QUEUES } from "@echo/jobs";
import { createLogger, initTracing } from "@echo/observability";
import { and, eq } from "drizzle-orm";
import { createApp } from "./app.ts";

const cfg = loadConfig("api");
const log = createLogger("api", cfg.LOG_LEVEL);
const flush = initTracing({ publicKey: cfg.LANGFUSE_PUBLIC_KEY, secretKey: cfg.LANGFUSE_SECRET_KEY, baseUrl: cfg.LANGFUSE_BASE_URL });
const pool = createPool(cfg.DATABASE_URL);
const db = createDb(pool);
const queue = new PgBossQueue(cfg.DATABASE_URL);
await queue.start();

const cipher = cfg.ENCRYPTION_KEY ? new TokenCipher(cfg.ENCRYPTION_KEY) : null;
if (!cipher) log.warn("ENCRYPTION_KEY ausente: o aviso de RH responde 503");

const app = createApp({
  ready: () => ping(pool),
  version: process.env.RENDER_GIT_COMMIT?.slice(0, 7),
  webhooks: {
    secrets: { github: cfg.GITHUB_WEBHOOK_SECRET, slack: cfg.SLACK_SIGNING_SECRET, linear: cfg.LINEAR_WEBHOOK_SECRET },
    receive: (d) => receive(db, queue, d),
    routeOrg: (kind, externalId) => routeOrg(db, kind, externalId),
    slackContext: async (orgId) => {
      const rows = await db
        .select({ id: identities.externalId })
        .from(identities)
        .where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack")));
      return { registeredUserIds: new Set(rows.map((r) => r.id)) };
    },
    orgSecrets: { hr: async (orgId) => (cipher ? hrSecret(db, cipher, orgId) : null) },
    hr: async (orgId, event) => {
      const r = await applyHrEvent(db, orgId, event);
      // A frente Funções monta a redistribuição a partir daqui.
      if (r.status === "registered") await queue.send(QUEUES.absenceRegistered, { orgId, absenceId: r.absenceId }, { singletonKey: r.absenceId });
      return r;
    },
    slackInteraction: async (orgId, payload) => {
      await queue.send(QUEUES.slackInteraction, { orgId, payload });
    },
    onError: (err, where) => log.error({ err, where }, "falha no webhook"),
  },
});
for (const [name, secret] of Object.entries({ GITHUB_WEBHOOK_SECRET: cfg.GITHUB_WEBHOOK_SECRET, SLACK_SIGNING_SECRET: cfg.SLACK_SIGNING_SECRET, LINEAR_WEBHOOK_SECRET: cfg.LINEAR_WEBHOOK_SECRET })) {
  if (!secret) log.warn({ variavel: name }, "segredo de webhook ausente: a rota responde 503");
}

const port = listenPort(cfg);
const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => log.info({ port: info.port }, "api no ar"));

async function shutdown(signal: string) {
  log.info({ signal }, "encerrando api");
  server.close();
  await Promise.allSettled([queue.stop(), pool.end(), flush()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
