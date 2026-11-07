// Fluxo de resposta a um colega (F2) e pergunta livre ao Echo (F2b), etapa 6.
// Laço com ferramentas somente leitura, até 4 rodadas e 30 s, Sonnet 5.5 com esforço baixo e saída
// estruturada. O validador em código confere a saída; o código acrescenta "Agente de <nome>", a hora de
// volta, as fontes e o aviso de nota não confirmada. Sem modelo (API fora, recusa ou teto), responde por regra.
// Toda execução grava uma linha em agent_runs.
import type Anthropic from "@anthropic-ai/sdk";
import type { BrainStore } from "@echo/brain";
import { type Clock, costLevel, digestKind, digestLine, isAway, localDate, systemClock, type AwayResult } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import { modelCostUsd, type Usage } from "./cost.ts";
import type { AgentData } from "./data.ts";
import { type AnswerOutput, answerOutputSchema, type AnswerRequest, type AnswerResult, LIMITS, MODELS, type ValidationIssue } from "./index.ts";
import { ANSWER_OUTPUT_JSON_SCHEMA, ANSWER_SYSTEM, questionMessage } from "./prompt.ts";
import { ECHO_PAUSED, forbiddenRequest, ruleAnswer } from "./rule-answer.ts";
import { firstName, newRunState, runTool, type ToolContext, toolsFor } from "./tools.ts";
import { validateAnswer } from "./validator.ts";
import { isWhoKnowsQuestion, modelTerms, topicPhrase, whoKnowsOutput } from "./who-knows.ts";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.Messages.BetaMessage;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;

/** Uma chamada ao Messages API. Em produção é `client.beta.messages.create`; nos testes, um roteiro. */
export type ModelCall = (params: CreateParams, options: { signal: AbortSignal; timeout: number }) => Promise<Message>;

export interface AnswerDeps {
  data: (orgId: string) => AgentData;
  brain: (orgId: string) => BrainStore;
  /** Sem modelo (sem chave), tudo sai por regra. */
  model?: ModelCall | null;
  recorder: RunRecorder;
  clock?: Clock;
  limits?: Partial<{ maxRounds: number; timeoutMs: number }>;
  /** Ensaio de dia (DEMO_ALWAYS_AWAY): o dono é tratado como ausente, com a volta no próximo expediente. */
  alwaysAway?: boolean;
}

/** No expediente, a volta "de ensaio" é o próximo início de expediente depois do fim de hoje. */
function rehearsalAway(owner: Parameters<typeof isAway>[0], absences: Parameters<typeof isAway>[1], now: Date): AwayResult {
  for (let h = 1; h <= 72; h++) {
    const later = isAway(owner, absences, new Date(now.getTime() + h * 3_600_000));
    if (later.away) return { away: true, reason: "off_hours", ...(later.returnsAt ? { returnsAt: later.returnsAt } : {}) };
  }
  return { away: true, reason: "off_hours" };
}

/** Recusa por política com reencaminhamento automático no servidor (refusals-and-fallback). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_TOKENS = 4096;

type LoopOutcome =
  | { kind: "ok"; out: AnswerOutput }
  | { kind: "refused"; reason: string; issues?: ValidationIssue[] }
  | { kind: "failed"; error: string };

interface LoopStats {
  usage: Usage;
  costUsd: number;
  model: string;
}

export function createAnswer(deps: AnswerDeps): (req: AnswerRequest) => Promise<AnswerResult> {
  const clock = deps.clock ?? systemClock;
  const maxRounds = deps.limits?.maxRounds ?? LIMITS.maxRounds;
  const timeoutMs = deps.limits?.timeoutMs ?? LIMITS.timeoutMs;

  return async function answer(req: AnswerRequest): Promise<AnswerResult> {
    const started = performance.now();
    const now = clock.now();
    const state = newRunState();
    const stats: LoopStats = { usage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, costUsd: 0, model: MODELS.answer };
    let flow: "answer" | "quem_sabe" = "answer";
    const record = (run: Omit<AgentRun, "flow" | "orgId" | "durationMs" | "tools">) =>
      deps.recorder.record({
        flow,
        orgId: req.orgId,
        durationMs: Math.round(performance.now() - started),
        tools: [...new Set(state.toolsUsed)],
        ...run,
      });

    try {
      const data = deps.data(req.orgId);
      const [settings, people, absences] = await Promise.all([data.orgSettings(), data.people(), data.absences()]);
      const asker = people.find((p) => p.id === req.askerId);
      if (!asker) throw new Error("quem pergunta não pertence a esta empresa");
      const owner = req.ownerId ? people.find((p) => p.id === req.ownerId) : undefined;
      if (req.ownerId && !owner) throw new Error("dono do agente não pertence a esta empresa");

      const ownerName = owner ? firstName(owner) : undefined;
      const real: AwayResult | undefined = owner ? isAway(owner, absences, now) : undefined;
      const away: AwayResult | undefined = owner && real && !real.away && deps.alwaysAway ? rehearsalAway(owner, absences, now) : real;
      const ownerNote = owner ? await data.latestDailyNote(owner.id) : null;
      const ctx: ToolContext = { data, brain: deps.brain(req.orgId), now, asker, owner, settings, people, absences, state };

      const warnings: string[] = [];
      if (ownerNote && ownerNote.state !== "confirmed") warnings.push(`nota do dia de ${ownerNote.date} não confirmada por ${ownerName}`);

      // Teto de custo: 100% pausa a pergunta livre e quem está disponível; 200% tira a IA de todos.
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const level = costLevel(await data.spentUsdSince(monthStart), settings.monthlyLimitUsd);
      let ruleReason: string | undefined;
      if (!deps.model) ruleReason = "modelo indisponível";
      else if (level === "hard_limit") ruleReason = "limite de custo do mês";
      else if (level === "rules_only" && !(away?.away ?? false)) ruleReason = "limite de custo do mês";

      const finish = async (out: AnswerOutput, usedModel: boolean, result: AgentRun["result"], extraWarning?: string, error?: string): Promise<AnswerResult> => {
        if (extraWarning) warnings.push(extraWarning);
        const kind = flow === "quem_sabe" ? "quem_sabe" : owner ? "gemeo" : "livre";
        // Acima do dobro do limite, a resposta por regra não conta nos ganhos: sem a volta gravada.
        const countsForGains = !(ruleReason && level === "hard_limit");
        const final = compose({ out, agentName: owner ? `Agente de ${ownerName}` : "Echo", ownerName, away, countsForGains, askerTz: asker.timezone, ctx, usedModel, warnings, kind, question: req.text });
        await record({
          result,
          ...(usedModel || stats.usage.input > 0
            ? { model: stats.model, inputTokens: stats.usage.input + stats.usage.cacheWrite + stats.usage.cacheRead, outputTokens: stats.usage.output, costUsd: stats.costUsd }
            : {}),
          ...(error ? { error } : {}),
        });
        return final;
      };

      // Aprovar, publicar ou avaliar pessoas: recusa fixa, sem modelo.
      const forbidden = forbiddenRequest(req.text, ownerName);
      if (forbidden) return finish(forbidden, false, "refused");

      // Quem sabe (F9): o modelo só gera termos de busca; pessoas e texto saem das regras e do código.
      // A 100% do limite segue por regra.
      if (!owner && isWhoKnowsQuestion(req.text)) {
        flow = "quem_sabe";
        const phrase = topicPhrase(req.text);
        const terms = phrase ? [phrase] : [req.text];
        let usedModel = false;
        let failure: string | undefined;
        if (deps.model && level !== "rules_only" && level !== "hard_limit") {
          try {
            const t = await modelTerms(deps.model, req.text, Math.max(started + timeoutMs - performance.now(), 1));
            stats.usage = t.usage;
            stats.costUsd = t.costUsd;
            stats.model = t.model;
            terms.push(...t.terms);
            usedModel = true;
          } catch (err) {
            failure = err instanceof Error ? err.message : String(err);
          }
        }
        const out = await whoKnowsOutput(ctx, [...new Set(terms)], phrase ?? "esse tema");
        if (usedModel) return finish(out, true, "ok");
        return finish(out, false, "fallback", failure ? "termos de busca por regra: modelo indisponível" : undefined, failure);
      }

      if (ruleReason) {
        if (level === "rules_only" && !owner && deps.model) return finish(ECHO_PAUSED, false, "fallback", "perguntas livres pausadas pelo limite de custo");
        return finish(await ruleAnswer(ctx, req.text), false, "fallback", `resposta por regra: ${ruleReason}`);
      }

      const outcome = await modelLoop({
        call: deps.model!,
        ctx,
        req,
        ownerName,
        ownerAway: away?.away ?? false,
        today: localDate(now, asker.timezone),
        maxRounds,
        deadline: started + timeoutMs,
        stats,
      });
      if (outcome.kind === "ok") return finish(outcome.out, true, "ok");
      const fallback = await ruleAnswer(ctx, req.text);
      if (outcome.kind === "refused") {
        const detail = outcome.issues?.map((i) => `${i.code}: ${i.detail}`).join("; ");
        return finish(fallback, false, "refused", `resposta por regra: ${outcome.reason}`, detail ?? outcome.reason);
      }
      return finish(fallback, false, "fallback", "resposta por regra: modelo indisponível", outcome.error);
    } catch (err) {
      await record({ result: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };
}

async function modelLoop(input: {
  call: ModelCall;
  ctx: ToolContext;
  req: AnswerRequest;
  ownerName: string | undefined;
  ownerAway: boolean;
  today: string;
  maxRounds: number;
  deadline: number;
  stats: LoopStats;
}): Promise<LoopOutcome> {
  const { call, ctx, stats } = input;
  const tools = toolsFor(ctx.asker);
  const messages: MessageParam[] = [
    {
      role: "user",
      content: questionMessage({ req: input.req, askerName: firstName(ctx.asker), askerRole: ctx.asker.role, ownerName: input.ownerName, ownerAway: input.ownerAway, today: input.today }),
    },
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(input.deadline - performance.now(), 0));
  let lastIssues: ValidationIssue[] | undefined;

  try {
    for (let round = 1; round <= input.maxRounds; round++) {
      const remaining = input.deadline - performance.now();
      if (remaining <= 0) return { kind: "failed", error: "tempo esgotado (30 s)" };
      const lastRound = round === input.maxRounds;

      let res: Message;
      try {
        res = await call(
          {
            model: MODELS.answer,
            max_tokens: MAX_TOKENS,
            // Instruções e ferramentas estáveis no início, com cache; o que varia vem nas mensagens.
            system: [{ type: "text", text: ANSWER_SYSTEM, cache_control: { type: "ephemeral" } }],
            tools,
            ...(lastRound ? { tool_choice: { type: "none" } } : {}),
            messages,
            output_config: { effort: "low", format: { type: "json_schema", schema: ANSWER_OUTPUT_JSON_SCHEMA } },
            betas: [FALLBACK_BETA],
            fallbacks: "default",
          },
          { signal: controller.signal, timeout: Math.max(Math.floor(remaining), 1) },
        );
      } catch (err) {
        return { kind: "failed", error: controller.signal.aborted ? "tempo esgotado (30 s)" : err instanceof Error ? err.message : String(err) };
      }

      const u = res.usage;
      const usage = { input: u.input_tokens, output: u.output_tokens, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
      stats.usage.input += usage.input;
      stats.usage.output += usage.output;
      stats.usage.cacheWrite += usage.cacheWrite;
      stats.usage.cacheRead += usage.cacheRead;
      stats.costUsd += modelCostUsd(res.model, usage);
      stats.model = res.model;

      if (res.stop_reason === "refusal") return { kind: "refused", reason: "o modelo recusou a pergunta" };
      if (res.stop_reason === "max_tokens") return { kind: "failed", error: "resposta cortada (max_tokens)" };

      if (res.stop_reason === "tool_use") {
        messages.push({ role: "assistant", content: res.content });
        const calls = res.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
        // Todas as respostas de ferramenta voltam numa única mensagem.
        const results = await Promise.all(
          calls.map(async (c) => {
            const r = await runTool(ctx, c.name, (c.input ?? {}) as Record<string, unknown>);
            return { type: "tool_result" as const, tool_use_id: c.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
          }),
        );
        messages.push({ role: "user", content: results });
        continue;
      }

      const text = res.content
        .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      const parsed = parseOutput(text);
      if (!parsed) {
        if (lastRound) return { kind: "failed", error: "saída fora do formato" };
        messages.push({ role: "assistant", content: res.content });
        messages.push({ role: "user", content: "A saída não seguiu o formato JSON pedido. Devolva só o JSON." });
        continue;
      }

      const issues = validateAnswer(parsed, {
        ...(input.ownerName ? { ownerName: input.ownerName } : {}),
        sourcesThisRun: [...ctx.state.sources.keys()],
        releasedTargets: [...ctx.state.released],
        allowedNumbers: [...ctx.state.numbers],
      });
      if (issues.length === 0) return { kind: "ok", out: parsed };
      lastIssues = issues;
      if (lastRound) break;
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: `O validador do sistema recusou a resposta: ${issues.map((i) => `${i.code} (${i.detail})`).join("; ")}. Corrija seguindo as regras e devolva o JSON.`,
      });
    }
  } finally {
    clearTimeout(timer);
  }
  return { kind: "refused", reason: "resposta do modelo recusada pelo validador", ...(lastIssues ? { issues: lastIssues } : {}) };
}

function parseOutput(text: string): AnswerOutput | null {
  try {
    const r = answerOutputSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** O que o código acrescenta: nome do agente, hora de volta, fontes com rótulo e avisos. */
function compose(input: {
  out: AnswerOutput;
  agentName: string;
  ownerName: string | undefined;
  away: AwayResult | undefined;
  askerTz: string;
  ctx: ToolContext;
  usedModel: boolean;
  warnings: string[];
  kind: NonNullable<AnswerResult["kind"]>;
  /** False acima do dobro do limite: a volta não é gravada e a resposta não entra na espera evitada. */
  countsForGains: boolean;
  question: string;
}): AnswerResult {
  const { out, away, ownerName } = input;
  let text = out.texto.trim();
  if (ownerName && away?.away) {
    text += away.returnsAt ? `\n\n${ownerName} volta ${formatReturn(away.returnsAt, input.askerTz)} (no seu fuso).` : `\n\n${ownerName} está ausente, sem data de volta registrada.`;
  }
  const sources = [...new Set(out.fontes)].map((ref) => input.ctx.state.sources.get(ref)).filter((s) => s !== undefined);
  return {
    agentName: input.agentName,
    text,
    sources,
    needsOwner: out.precisa_do_dono || (out.status === "nao_sei" && !!ownerName),
    ...(away?.away && away.returnsAt && input.countsForGains ? { ownerReturnsAt: away.returnsAt } : {}),
    usedModel: input.usedModel,
    warnings: [...input.warnings],
    kind: input.kind,
    // Resumo da ausência: tipo e linhas por regra, só para quem tem dono.
    ...(ownerName ? { digest: { kind: digestKind(input.question), request: digestLine(input.question), reply: digestLine(out.texto) } } : {}),
  };
}

/** "segunda-feira, 09/11, às 09:00" no fuso de quem pergunta. */
export function formatReturn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")}/${get("month")}, às ${get("hour")}:${get("minute")}`;
}
