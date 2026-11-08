// Dependências padrão do fluxo de resposta, só no servidor: Postgres, BrainStore e a chave da empresa.
import Anthropic from "@anthropic-ai/sdk";
import { createPgBrainStore } from "@echo/brain/pg";
import { createPgOutbox } from "@echo/actions/pg";
import { agentRuns, asSystem, createDb, createPool, type Database, orgs, withOrg } from "@echo/db";
import { awayDigestDue, digestPurgeBefore, endOfDayDue, morningDue, parseGainsBaseline, reportsDue } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import { type AnswerDeps, createAnswer, type ModelCall } from "./answer.ts";
import type { AnswerRequest, AnswerResult } from "./index.ts";
import { createEndOfDay, type EndOfDay } from "./daily-note.ts";
import { createPgAgentData } from "./pg-data.ts";
import { createPgDailyNoteStore } from "./pg-notes.ts";
import { createMorningPlan, type MorningPlan } from "./morning-plan.ts";
import { type BatchApi, createNightReview, type NightReview, type ReviewSource } from "./night-review.ts";
import { createPgPlanStore, createPgReviewStore } from "./pg-night.ts";
import { ollamaJson, ollamaTriage } from "./triage-ollama.ts";
import { createDaySummary, type DaySummary, type DaySummaryDeps } from "./day-summary.ts";
import { createPgArtifactStore } from "./pg-artifacts.ts";
import { onboardPerson } from "./onboarding.ts";
import { createPgAvatarStore, createPgOnboardingStore } from "./pg-onboarding.ts";
import { adjustAvatar, redoAvatar } from "./redo-avatar.ts";
import { createFix, type Fix, type FixCodeHost } from "./fix.ts";
import { createManagedFixSandbox, fixAgentParams, fixEnvironmentParams } from "./managed-fix.ts";
import { createPgFixStore, pgDelegationOf } from "./pg-fix.ts";
import type { DelegationModel } from "./delegation.ts";
import { createRedistribution, type Redistribution } from "./redistribution.ts";
import { createPgRedistributionStore } from "./pg-redistribution.ts";
import { createWeeklyReport, type WeeklyReport } from "./report.ts";
import { createPgReportStore } from "./pg-report.ts";
import { createGains, type Gains } from "./gains.ts";
import { createPgGainsStore } from "./pg-gains.ts";
import { createAwayDigest, type AwayDigest } from "./away-digest.ts";
import { createPgDigestStore } from "./pg-away-digest.ts";

export { createPgAgentData } from "./pg-data.ts";
export { createPgDailyNoteStore } from "./pg-notes.ts";
export { createPgPlanStore, createPgReviewStore } from "./pg-night.ts";
export { ollamaBaseUrl, ollamaJson, ollamaTriage } from "./triage-ollama.ts";
export { createPgArtifactStore } from "./pg-artifacts.ts";
export { createPgAvatarStore, createPgOnboardingStore, readAvatar, updateProfile } from "./pg-onboarding.ts";
export { createPgFixStore } from "./pg-fix.ts";
export { createPgRedistributionStore } from "./pg-redistribution.ts";
export { createPgReportStore } from "./pg-report.ts";
export { createGithubGainsHistory, createPgGainsStore, type CodeHistorySource } from "./pg-gains.ts";
export { createPgDigestStore } from "./pg-away-digest.ts";
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
    router: answerRouter(),
  };
}

/**
 * Roteador de custo da resposta: a regra sempre. O SSLM só entra com SSLM_MODEL definido (e SLM_OLLAMA_URL): os
 * modelos testados erraram demais (docs/engenharia.md). ANSWER_ROUTER=false manda toda pergunta ao modelo, como antes.
 */
export function answerRouter(env: NodeJS.ProcessEnv = process.env): AnswerDeps["router"] {
  if (env.ANSWER_ROUTER === "false") return undefined;
  const timeoutMs = Number(env.SSLM_TIMEOUT_MS) > 0 ? Number(env.SSLM_TIMEOUT_MS) : undefined;
  const sslm = env.SLM_OLLAMA_URL && env.SSLM_MODEL ? ollamaJson({ baseUrl: env.SLM_OLLAMA_URL, model: env.SSLM_MODEL, think: false }) : null;
  return { sslm, ...(timeoutMs ? { timeoutMs } : {}) };
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
 * sem chave da API, não há revisão. Com `triage` (Ollama), um modelo aberto pequeno faz a triagem antes do lote.
 */
export function serverNightReview(db: Database, apiKey: string | undefined, diffs: (orgId: string) => ReviewSource, triage?: { url: string; model: string; timeoutMs: number }): NightReview {
  return createNightReview({
    data: (orgId) => createPgAgentData(db, orgId),
    brain: (orgId) => createPgBrainStore(db, orgId),
    reviews: (orgId) => createPgReviewStore(db, orgId),
    diffs,
    outbox: (orgId) => createPgOutbox(db, orgId),
    batches: apiKey ? anthropicBatchApi(apiKey) : null,
    recorder: createDbRunRecorder(db),
    triage: triage ? { model: ollamaTriage({ baseUrl: triage.url, model: triage.model }), timeoutMs: triage.timeoutMs } : null,
  });
}

/**
 * Resumo do dia (etapa 26): depois do rascunho da nota, o modelo aberto do Ollama monta a especificação do
 * resumo. Sem `ollama`, layout padrão por regra.
 */
export function serverDaySummary(db: Database, ollama?: { url: string; model: string; timeoutMs: number }, webUrl?: string, renderImage?: DaySummaryDeps["renderImage"]): DaySummary {
  return createDaySummary({
    data: (orgId) => createPgAgentData(db, orgId),
    notes: (orgId) => createPgDailyNoteStore(db, orgId),
    artifacts: (orgId) => createPgArtifactStore(db, orgId),
    model: ollama ? ollamaJson({ baseUrl: ollama.url, model: ollama.model }) : null,
    recorder: createDbRunRecorder(db),
    timeoutMs: ollama?.timeoutMs,
    outbox: (orgId) => createPgOutbox(db, orgId),
    webUrl,
    // A imagem (satori + resvg, binário nativo) é ligada só no worker, por @echo/agents/imagem: o painel não a empacota.
    ...(renderImage ? { renderImage } : {}),
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
export function serverFix(db: Database, opts: { apiKey?: string | undefined; agentId?: string | undefined; environmentId?: string | undefined; timeoutMs?: number; codeHost: (orgId: string) => FixCodeHost | null | Promise<FixCodeHost | null>; judge?: { url: string; model: string; timeoutMs: number } | undefined }): Fix {
  const sandbox =
    opts.apiKey && opts.agentId && opts.environmentId
      ? createManagedFixSandbox(new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 }), { agentId: opts.agentId, environmentId: opts.environmentId, ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) })
      : null;
  return createFix({
    data: (orgId) => createPgAgentData(db, orgId),
    fixes: (orgId) => createPgFixStore(db, orgId),
    codeHost: opts.codeHost,
    personBySlackUser: (orgId, slackUserId) => createPgDailyNoteStore(db, orgId).personBySlackUser(slackUserId),
    sandbox,
    outbox: (orgId) => createPgOutbox(db, orgId),
    recorder: createDbRunRecorder(db),
    // Com o Ollama (o mesmo da triagem), a delegação escrita pela pessoa pode unir a correção por ela.
    delegation: opts.judge ? { judge: delegationJudge(ollamaJson({ baseUrl: opts.judge.url, model: opts.judge.model })), timeoutMs: opts.judge.timeoutMs, of: pgDelegationOf(db) } : null,
  });
}

/** Redistribuição (etapa 11) com Postgres e outbox. Sem modelo: plano, motivos e mensagens saem das regras. */
export function serverRedistribution(db: Database, webUrl: string): Redistribution {
  return createRedistribution({
    data: (orgId) => createPgAgentData(db, orgId),
    store: (orgId) => createPgRedistributionStore(db, orgId),
    outbox: (orgId) => createPgOutbox(db, orgId),
    recorder: createDbRunRecorder(db),
    webUrl,
  });
}

/** Relatório semanal (etapa 12) com Postgres, outbox e a chave da empresa. Sem chave, o texto sai por regra. */
export function serverWeeklyReport(db: Database, apiKey: string | undefined, webUrl: string): WeeklyReport {
  return createWeeklyReport({
    data: (orgId) => createPgAgentData(db, orgId),
    reports: (orgId) => createPgReportStore(db, orgId),
    outbox: (orgId) => createPgOutbox(db, orgId),
    model: apiKey ? anthropicModelCall(apiKey) : null,
    recorder: createDbRunRecorder(db),
    webUrl,
  });
}

/** Ganhos (etapa 13) com Postgres. Sem modelo. */
export function serverGains(db: Database): Gains {
  return createGains({ data: (orgId) => createPgAgentData(db, orgId), store: (orgId) => createPgGainsStore(db, orgId), recorder: createDbRunRecorder(db) });
}

/** A referência dos Ganhos ainda não foi medida nesta empresa? */
export async function needsGainsBaseline(db: Database, orgId: string): Promise<boolean> {
  return !parseGainsBaseline(await createPgGainsStore(db, orgId).baseline());
}

/** Resumo da ausência (etapa 13) com Postgres e outbox. Sem modelo. */
export function serverAwayDigest(db: Database, webUrl: string): AwayDigest {
  return createAwayDigest({
    data: (orgId) => createPgAgentData(db, orgId),
    store: (orgId) => createPgDigestStore(db, orgId),
    outbox: (orgId) => createPgOutbox(db, orgId),
    recorder: createDbRunRecorder(db),
    webUrl,
  });
}

/** Quem está no início ou no fim do expediente com algo no resumo, em todas as empresas. */
export async function dueAwayDigests(db: Database, now: Date): Promise<{ orgId: string; personId: string; date: string; slot: "inicio" | "fim" }[]> {
  const due: { orgId: string; personId: string; date: string; slot: "inicio" | "fim" }[] = [];
  for (const orgId of await allOrgIds(db)) {
    const data = createPgAgentData(db, orgId);
    const store = createPgDigestStore(db, orgId);
    const [people, absences] = await Promise.all([data.people(), data.absences()]);
    for (const person of people) {
      // Sem o último envio, a regra das 3 horas não vale: só consulta quem está na janela.
      if (!awayDigestDue(person, absences, now)) continue;
      const d = awayDigestDue(person, absences, now, await store.lastSentAt(person.id));
      if (d && (await store.pending(person.id, digestPurgeBefore(now))).length > 0) due.push({ orgId, personId: person.id, ...d });
    }
  }
  return due;
}

/** Relatórios que já passaram do corte e ainda não existem, em todas as empresas. */
export async function dueWeeklyReports(db: Database, now: Date): Promise<{ orgId: string; personId: string; week: string; cutoff: string }[]> {
  const due: { orgId: string; personId: string; week: string; cutoff: string }[] = [];
  for (const orgId of await allOrgIds(db)) {
    const people = await createPgAgentData(db, orgId).people();
    const store = createPgReportStore(db, orgId);
    for (const person of people) {
      for (const d of reportsDue(person, now)) if (!(await store.get(person.id, d.week))) due.push({ orgId, personId: person.id, week: d.week, cutoff: d.cutoff.toISOString() });
    }
  }
  return due;
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

/**
 * Quem está perto do início do expediente agora e ainda não tem o plano da data, em todas as empresas.
 * Quem já tem plano fica fora: a `singletonKey` não segura o job depois de concluído (pg-boss, fila padrão),
 * e sem este filtro a agenda poria um job por passada na janela, cada um com uma linha "pulado" em agent_runs.
 */
export async function dueMorning(db: Database, now: Date): Promise<{ orgId: string; personId: string; date: string }[]> {
  const due: { orgId: string; personId: string; date: string }[] = [];
  for (const orgId of await allOrgIds(db)) {
    const data = createPgAgentData(db, orgId);
    const plans = createPgPlanStore(db, orgId);
    const [people, absences] = await Promise.all([data.people(), data.absences()]);
    for (const person of people) {
      const d = morningDue(person, absences, now);
      if (d && !(await plans.get(person.id, d.date))) due.push({ orgId, personId: person.id, date: d.date });
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

/** O juiz da delegação sobre o cliente JSON do Ollama (saída restrita ao esquema). */
function delegationJudge(m: { model: string; json: (r: { system: string; user: string; schema: object }, s: AbortSignal) => Promise<{ raw: unknown; inputTokens?: number; outputTokens?: number }> }): DelegationModel {
  return { model: m.model, classify: (request, signal) => m.json(request, signal) };
}

/** Cadastro pelo RH: currículo no modelo aberto (se houver Ollama) e foto no Claude (se houver chave). */
export function serverOnboarding(db: Database, opts: { apiKey?: string | undefined; ollama?: { url: string; model: string; timeoutMs: number } | undefined }) {
  return onboardPerson({
    store: createPgOnboardingStore(db),
    slm: opts.ollama ? ollamaJson({ baseUrl: opts.ollama.url, model: opts.ollama.model }) : null,
    vision: opts.apiKey ? anthropicModelCall(opts.apiKey) : null,
    recorder: createDbRunRecorder(db),
    ...(opts.ollama ? { timeoutMs: opts.ollama.timeoutMs } : {}),
  });
}

/** Trocar o bonequinho: pela foto (Claude, se houver chave) ou à mão. */
export function serverAvatar(db: Database, apiKey: string | undefined) {
  const deps = { store: createPgAvatarStore(db), vision: apiKey ? anthropicModelCall(apiKey) : null, recorder: createDbRunRecorder(db) };
  return { redo: redoAvatar(deps), adjust: adjustAvatar(deps) };
}
