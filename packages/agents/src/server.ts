// Dependências padrão do fluxo de resposta, só no servidor: Postgres, BrainStore e a chave da empresa.
import Anthropic from "@anthropic-ai/sdk";
import { createPgBrainStore } from "@echo/brain/pg";
import { createPgOutbox } from "@echo/actions/pg";
import { agentRuns, asSystem, createDb, createPool, type Database, orgs, withOrg } from "@echo/db";
import { endOfDayDue } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import { type AnswerDeps, createAnswer, type ModelCall } from "./answer.ts";
import type { AnswerRequest, AnswerResult } from "./index.ts";
import { createEndOfDay, type EndOfDay } from "./daily-note.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createPgDailyNoteStore } from "./pg-notes.ts";

export { createPgAgentData } from "./pg-data.ts";
export { createPgDailyNoteStore } from "./pg-notes.ts";

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
