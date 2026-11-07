// Dependências padrão do fluxo de resposta, só no servidor: Postgres, BrainStore e a chave da empresa.
import Anthropic from "@anthropic-ai/sdk";
import { createPgBrainStore } from "@echo/brain/pg";
import { createPgOutbox } from "@echo/actions/pg";
import { agentRuns, asSystem, createDb, createPool, type Database, orgs, withOrg } from "@echo/db";
import { endOfDayDue, morningDue } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import { type AnswerDeps, createAnswer, type ModelCall } from "./answer.ts";
import type { AnswerRequest, AnswerResult } from "./index.ts";
import { createEndOfDay, type EndOfDay } from "./daily-note.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createPgDailyNoteStore } from "./pg-notes.ts";
import { createMorningPlan, type MorningPlan } from "./morning-plan.ts";
import { type BatchApi, createNightReview, type NightReview, type ReviewSource } from "./night-review.ts";
import { createPgPlanStore, createPgReviewStore } from "./pg-night.ts";
import { createFix, type Fix, type FixCodeHost } from "./fix.ts";
import { createManagedFixSandbox, fixAgentParams, fixEnvironmentParams } from "./managed-fix.ts";
import { createPgFixStore } from "./pg-fix.ts";

export { createPgAgentData } from "./pg-data.ts";
export { createPgDailyNoteStore } from "./pg-notes.ts";
export { createPgPlanStore, createPgReviewStore } from "./pg-night.ts";
export { createPgFixStore } from "./pg-fix.ts";
export { createManagedFixSandbox, fixAgentParams, fixEnvironmentParams, fixPrompt, readFixOutputs, driveSession, sessionCost, REPO_PATH, OUTPUTS } from "./managed-fix.ts";

/** Grava cada execução em agent_runs, dentro da empresa (RLS). */
export function createDbRunRecorder(db: Database): RunRecorder {
  return {
    async record(run: AgentRun) {
      const values = {
        flow: run.flow,
        model: run.model ?? null,
        inputTokens: run.inputTokens ?? null,
        outputTokens: run.outputTokens ?? null,
        costUsd: run.costUsd !== undefined ? run.costUsd.toFixed(6) : null,
        durationMs: run.durationMs,
        tools: run.tools ?? [],
        result: run.result,
        error: run.error?.slice(0, 2000) ?? null,
      };
      if (!run.orgId) throw new Error("agent_runs: execução sem empresa");
      await withOrg(db, run.orgId, (tx) => tx.insert(agentRuns).values({ ...values, orgId: run.orgId! }));
    },
  };
}

/** Chamada real ao Messages API com a chave da empresa (nunca login do claude.ai). */
export function anthropicModelCall(apiKey: string): ModelCall {
  const client = new Anthropic({ apiKey, maxRetries: 1 });
  return (params, options) => client.beta.messages.create(params, options);
}

export function serverAnswerDeps(db: Database, apiKey: string | undefined): AnswerDeps {
  return {
    data: (orgId) => createPgAgentData(db, orgId),
    brain: (orgId) => createPgBrainStore(db, orgId),
    model: apiKey ? anthropicModelCall(apiKey) : null,
    recorder: createDbRunRecorder(db),
    // Só para ensaiar a demonstração de dia: o dono da pergunta é tratado como ausente.
    alwaysAway: process.env.DEMO_ALWAYS_AWAY === "true",
  };
}

/** Fluxo do fim do expediente com Postgres, outbox e a chave da empresa (sem chave, "onde parou" por regra). */
export function serverEndOfDay(db: Database, apiKey: string | undefined, webUrl: string): EndOfDay {
  return createEndOfDay({
    data: (orgId) => createPgAgentData(db, orgId),
    notes: (orgId) => createPgDailyNoteStore(db, orgId),
    outbox: (orgId) => createPgOutbox(db, orgId),
    model: apiKey ? anthropicModelCall(apiKey) : null,
    recorder: createDbRunRecorder(db),
    webUrl,
  });
}

/** API de lotes da Anthropic com a chave da empresa. */
export function anthropicBatchApi(apiKey: string): BatchApi {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  return {
    async create(requests) {
      const b = await client.messages.batches.create({ requests });
      return { id: b.id };
    },
    async status(id) {
      return (await client.messages.batches.retrieve(id)).processing_status;
    },
    async *results(id) {
      for await (const item of await client.messages.batches.results(id)) yield item as never;
    },
  };
}

/**
 * Revisão noturna com Postgres, outbox e a API de lotes. O diff vem do GitHub (`diffs`, frente de Integrações);
 * sem chave da API, não há revisão.
 */
export function serverNightReview(db: Database, apiKey: string | undefined, diffs: (orgId: string) => ReviewSource): NightReview {
  return createNightReview({
    data: (orgId) => createPgAgentData(db, orgId),
    brain: (orgId) => createPgBrainStore(db, orgId),
    reviews: (orgId) => createPgReviewStore(db, orgId),
    diffs,
    outbox: (orgId) => createPgOutbox(db, orgId),
    batches: apiKey ? anthropicBatchApi(apiKey) : null,
    recorder: createDbRunRecorder(db),
  });
}

export function serverMorningPlan(db: Database, webUrl: string): MorningPlan {
  return createMorningPlan({
    data: (orgId) => createPgAgentData(db, orgId),
    plans: (orgId) => createPgPlanStore(db, orgId),
    outbox: (orgId) => createPgOutbox(db, orgId),
    recorder: createDbRunRecorder(db),
    webUrl,
  });
}

/**
 * Correção (etapa 10) com Postgres, outbox e o Managed Agents provisionado. Sem chave, sem FIX_AGENT_ID ou
 * FIX_ENVIRONMENT_ID, não há ambiente; sem a porta do GitHub (Integrações), não há correção. `decide` (Meu plano)
 * só precisa da porta do GitHub.
 */
export function serverFix(db: Database, opts: { apiKey?: string | undefined; agentId?: string | undefined; environmentId?: string | undefined; timeoutMs?: number; codeHost: (orgId: string) => FixCodeHost | null }): Fix {
  const sandbox =
    opts.apiKey && opts.agentId && opts.environmentId
      ? createManagedFixSandbox(new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 }), { agentId: opts.agentId, environmentId: opts.environmentId, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) })
      : null;
  return createFix({
    data: (orgId) => createPgAgentData(db, orgId),
    fixes: (orgId) => createPgFixStore(db, orgId),
    codeHost: opts.codeHost,
    sandbox,
    outbox: (orgId) => createPgOutbox(db, orgId),
    recorder: createDbRunRecorder(db),
  });
}

/**
 * Cria, uma vez, o ambiente e o agente da correção no Managed Agents. O que já existe é mantido (o agente é
 * atualizado no lugar, ganhando nova versão, em vez de criar outro).
 */
export async function provisionFix(apiKey: string, existing: { agentId?: string | undefined; environmentId?: string | undefined }): Promise<{ agentId: string; agentVersion: number; environmentId: string; created: string[] }> {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const created: string[] = [];
  const environmentId = existing.environmentId ?? (created.push("ambiente"), (await client.beta.environments.create(fixEnvironmentParams())).id);
  if (existing.agentId) {
    const current = await client.beta.agents.retrieve(existing.agentId);
    const updated = await client.beta.agents.update(existing.agentId, { ...fixAgentParams(), version: current.version });
    return { agentId: updated.id, agentVersion: updated.version, environmentId, created };
  }
  const agent = await client.beta.agents.create(fixAgentParams());
  created.push("agente");
  return { agentId: agent.id, agentVersion: agent.version, environmentId, created };
}

export async function allOrgIds(db: Database): Promise<string[]> {
  return (await asSystem(db, (tx) => tx.select({ id: orgs.id }).from(orgs))).map((o) => o.id);
}

/** Quem está perto do início do expediente agora, em todas as empresas (plano da manhã). */
export async function dueMorning(db: Database, now: Date): Promise<{ orgId: string; personId: string; date: string }[]> {
  const due: { orgId: string; personId: string; date: string }[] = [];
  for (const orgId of await allOrgIds(db)) {
    const data = createPgAgentData(db, orgId);
    const [people, absences] = await Promise.all([data.people(), data.absences()]);
    for (const person of people) {
      const d = morningDue(person, absences, now);
      if (d) due.push({ orgId, personId: person.id, date: d.date });
    }
  }
  return due;
}

/** Quem está no fim do expediente agora, em todas as empresas. A chave pessoa + data deixa repetir sem efeito. */
export async function dueEndOfDay(db: Database, now: Date): Promise<{ orgId: string; personId: string; date: string }[]> {
  const orgIds = await asSystem(db, (tx) => tx.select({ id: orgs.id }).from(orgs));
  const due: { orgId: string; personId: string; date: string }[] = [];
  for (const { id: orgId } of orgIds) {
    const data = createPgAgentData(db, orgId);
    const [people, absences] = await Promise.all([data.people(), data.absences()]);
    for (const person of people) {
      const d = endOfDayDue(person, absences, now);
      if (d) due.push({ orgId, personId: person.id, date: d.date });
    }
  }
  return due;
}

let cached: ((req: AnswerRequest) => Promise<AnswerResult>) | undefined;

/** answer() com DATABASE_URL e ANTHROPIC_API_KEY do ambiente; sem chave, responde por regra. */
export async function defaultAnswer(): Promise<(req: AnswerRequest) => Promise<AnswerResult>> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Defina DATABASE_URL");
  const db = createDb(createPool(url, 4, { defaultScope: "none" }));
  cached = createAnswer(serverAnswerDeps(db, process.env.ANTHROPIC_API_KEY || undefined));
  return cached;
}
