// Entrada idempotente (F1): gravar, enfileirar e responder rápido. Processar fica para o worker.
import { inboxEvents, installationRoutes, type Database } from "@echo/db";
import { QUEUES, type JobQueue } from "@echo/jobs";
import { and, eq, inArray } from "drizzle-orm";
import { normalizeGithub } from "./github.ts";
import { ingest, type IngestResult } from "./ingest.ts";
import { normalizeLinear } from "./linear.ts";
import { normalizeSlack } from "./slack.ts";

export type InboxSource = "github" | "slack" | "linear";

export interface Delivery {
  source: InboxSource;
  /** Identificador único da entrega na plataforma (X-GitHub-Delivery, Linear-Delivery, event_id do Slack). */
  deliveryId: string;
  /** Empresa já conhecida (rotas /o/<empresa>) ou a chave que aponta para ela em installation_routes. */
  orgId?: string | undefined;
  routeKey?: string | undefined;
  /** Para o GitHub, o nome do evento (X-GitHub-Event). */
  eventName?: string | undefined;
  payload: unknown;
}

export interface InboxJob {
  inboxId: string;
}

/** Acha a empresa pela instalação (GitHub), pelo espaço (Slack) ou pela organização (Linear). */
export async function routeOrg(db: Database, kind: InboxSource, externalId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: installationRoutes.orgId })
    .from(installationRoutes)
    .where(and(eq(installationRoutes.kind, kind), eq(installationRoutes.externalId, externalId)));
  return row?.orgId ?? null;
}

/**
 * Grava o aviso uma vez e enfileira. Reenvio do mesmo aviso não duplica; só volta para a fila
 * se ainda não foi processado. Sem empresa conhecida, o aviso é descartado (retorna "unrouted").
 */
export async function receive(db: Database, queue: Pick<JobQueue, "send">, d: Delivery): Promise<"queued" | "duplicate" | "unrouted"> {
  const orgId = d.orgId ?? (d.routeKey ? await routeOrg(db, d.source, d.routeKey) : null);
  if (!orgId) return "unrouted";
  const payload = { eventName: d.eventName ?? null, body: d.payload };
  const [inserted] = await db
    .insert(inboxEvents)
    .values({ orgId, source: d.source, deliveryId: d.deliveryId, payload })
    .onConflictDoNothing()
    .returning({ id: inboxEvents.id });
  let inboxId = inserted?.id;
  if (!inboxId) {
    const [existing] = await db
      .select({ id: inboxEvents.id })
      .from(inboxEvents)
      .where(and(eq(inboxEvents.source, d.source), eq(inboxEvents.deliveryId, d.deliveryId), inArray(inboxEvents.state, ["received", "failed"])));
    if (!existing) return "duplicate";
    inboxId = existing.id;
  }
  // singletonKey: duas entregas do mesmo aviso ao mesmo tempo viram um job só.
  await queue.send<InboxJob>(QUEUES.inboxProcess, { inboxId }, { singletonKey: inboxId });
  return inserted ? "queued" : "duplicate";
}

export interface ProcessOptions {
  /** user_id do bot Echo no Slack, para separar a menção ao bot das menções a pessoas. */
  slackBotUserId?: string | undefined;
  /** Repositório do espelho das notas: push nele não é trabalho. */
  brainsRepository?: string | undefined;
}

/** Processa um aviso gravado. Erro marca "failed" e relança, para a fila tentar de novo. */
export async function processInbox(db: Database, inboxId: string, opts: ProcessOptions = {}): Promise<IngestResult | null> {
  const [row] = await db.select().from(inboxEvents).where(and(eq(inboxEvents.id, inboxId), inArray(inboxEvents.state, ["received", "failed"])));
  if (!row?.orgId) return null;
  const { eventName, body } = row.payload as { eventName: string | null; body: any };
  try {
    const repo: string | undefined = body?.repository?.full_name;
    const isBrains = row.source === "github" && repo && opts.brainsRepository && repo.toLowerCase() === opts.brainsRepository.toLowerCase();
    const events = isBrains
      ? [{ kind: "ignored" as const, reason: "repositório do espelho" }]
      : row.source === "github"
        ? normalizeGithub(eventName ?? "", body)
        : row.source === "linear"
          ? normalizeLinear(body)
          : normalizeSlack(body, opts.slackBotUserId);
    const result = await ingest(db, row.orgId, events);
    const onlyIgnored = result.applied === 0 && result.messages.length === 0;
    // Texto do Slack não fica guardado depois de processado: a mensagem segue na fila do F2.
    const kept = row.source === "slack" && body?.event ? { eventName, body: { ...body, event: { ...body.event, text: null } } } : row.payload;
    await db
      .update(inboxEvents)
      .set({ state: onlyIgnored ? "ignored" : "processed", processedAt: new Date(), attempts: row.attempts + 1, error: null, payload: kept })
      .where(eq(inboxEvents.id, inboxId));
    return result;
  } catch (err) {
    await db
      .update(inboxEvents)
      .set({ state: "failed", attempts: row.attempts + 1, error: err instanceof Error ? err.message.slice(0, 500) : "erro" })
      .where(eq(inboxEvents.id, inboxId));
    throw err;
  }
}
