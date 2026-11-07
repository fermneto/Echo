// Dependências padrão do fluxo de resposta, só no servidor: Postgres, BrainStore e a chave da empresa.
import Anthropic from "@anthropic-ai/sdk";
import { createPgBrainStore } from "@echo/brain/pg";
import { agentRuns, createDb, createPool, type Database, withOrg } from "@echo/db";
import type { AgentRun, RunRecorder } from "@echo/observability";
import { type AnswerDeps, createAnswer, type ModelCall } from "./answer.ts";
import type { AnswerRequest, AnswerResult } from "./index.ts";
import { createPgAgentData } from "./pg-data.ts";

export { createPgAgentData } from "./pg-data.ts";

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
  };
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
