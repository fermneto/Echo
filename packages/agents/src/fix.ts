// Correção (etapa 10, F4 passos 4 a 6). Regras escolhem os achados; o agente trabalha num ambiente isolado
// do Managed Agents, com token de 1 h só leitura no proxy de Git, e devolve o `git diff` e o `fix.json`.
// Fora do ambiente, o código confere o diff; só então a plataforma pede, pelo outbox, a branch echo/fix-pr-N
// e o PR em rascunho. A IA não une nada: só a aprovação registrada do autor enfileira a união, e só se o
// rascunho não mudou.
import type { OutboxAction } from "@echo/actions";
import {
  checkFixDiff,
  type Clock,
  costLevel,
  fixBranch,
  fixDecision,
  fixMergeCheck,
  type FixSkipReason,
  type FixTarget,
  type PullHead,
  systemClock,
} from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import type { AgentData } from "./data.ts";
import { MODELS } from "./index.ts";
import { APPROVAL_PATTERN, cleanText, type Finding, PEOPLE_PATTERN, SEVERITY_LABEL } from "./night-review.ts";

// ---------- Portas

/** GitHub, pela frente de Integrações (CodeHost). */
export interface FixCodeHost {
  /** O PR como está agora: versão, branch, repositório de origem (fork) e branch padrão. */
  target(repository: string, number: number): Promise<FixTarget | null>;
  /** Token de instalação de 1 h, só `contents: read`, só deste repositório. Fica no proxy de Git, fora do ambiente. */
  readToken(repository: string): Promise<string>;
  pull(repository: string, number: number): Promise<PullHead | null>;
}

export interface FixSandboxInput {
  title: string;
  repository: string;
  headSha: string;
  token: string;
  pr: { number: number; title: string; branch: string };
  findings: Finding[];
  prFiles: string[];
  /** Teto da sessão (limite de custo do Managed Agents). */
  budgetUsd: number;
}

export interface FixSandboxResult {
  sessionId: string;
  outcome: "done" | "budget_reached" | "timeout" | "failed";
  diff: string | null;
  fixJson: unknown;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}

/** Ambiente isolado (Managed Agents). Sem segredos do Echo, rede só para registros de pacotes. */
export interface FixSandbox {
  run(input: FixSandboxInput): Promise<FixSandboxResult>;
}

export interface FixCandidate {
  reviewId: string;
  prId: string;
  pr: { repository: string; number: number; title: string; branch: string; authorId?: string };
  headSha: string;
  files: string[];
  findings: Finding[];
}

export type FixState = "running" | "draft_queued" | "ready" | "approved" | "applied" | "declined" | "rejected" | "failed" | "skipped";

export interface StoredFix {
  id: string;
  reviewId: string;
  pr: { repository: string; number: number; branch: string; authorId?: string };
  state: FixState;
  baseSha?: string;
  draftPrNumber?: number;
  draftHeadSha?: string;
  files: string[];
  tests?: FixTestResult;
  costUsd?: number;
}

/** Tabela `fix_runs`. Uma correção por revisão; cada mudança de estado só sai do estado esperado. */
export interface FixStore {
  /** Revisões com achados e sem correção. */
  candidates(): Promise<FixCandidate[]>;
  candidate(reviewId: string): Promise<FixCandidate | null>;
  /** Há correção deste PR em andamento ou esperando decisão (a branch echo/fix-pr-N está em uso). */
  openFixForPr(prId: string): Promise<boolean>;
  /** Gasto em correções dos PRs da pessoa desde a data. */
  personSpentUsdSince(personId: string, since: Date): Promise<number>;
  skip(reviewId: string, reason: FixSkipReason): Promise<boolean>;
  /** Null se a revisão já tem correção. A revisão passa a `fix_queued`. */
  start(reviewId: string, input: { baseSha: string; branch: string; findings: Finding[] }): Promise<{ id: string } | null>;
  /** Só sai de `running`. Recusada ou falha: a revisão volta a `reviewed`. */
  finish(id: string, result: { state: "draft_queued" | "rejected" | "failed"; sessionId?: string; files?: string[]; tests?: FixTestResult; costUsd?: number; error?: string }): Promise<boolean>;
  get(id: string): Promise<StoredFix | null>;
  inState(state: FixState): Promise<StoredFix[]>;
  /** Estado e retorno da ação no outbox, pela chave. */
  outboxResult(idempotencyKey: string): Promise<{ state: string; result: unknown; error?: string } | null>;
  /** `draft_queued` → `ready`; a revisão passa a `fix_ready`. */
  markReady(id: string, draft: { number: number; headSha: string }): Promise<boolean>;
  /** De `from` para `failed`, com o erro; a revisão volta a `reviewed`. */
  markFailed(id: string, from: FixState, error: string): Promise<boolean>;
  /** `ready` → `approved` ou `declined`, com quem decidiu. */
  decide(id: string, by: string, to: "approved" | "declined", at: Date): Promise<boolean>;
  /** `approved` → `applied`; a revisão também. */
  markApplied(id: string): Promise<boolean>;
}

export interface FixOutbox {
  enqueue(action: OutboxAction): Promise<{ id: string; duplicate: boolean }>;
}

export interface FixDeps {
  data: (orgId: string) => AgentData;
  fixes: (orgId: string) => FixStore;
  /** Sem a porta do GitHub, não há correção. */
  codeHost: (orgId: string) => FixCodeHost | null;
  /** Sem agente e ambiente provisionados (FIX_AGENT_ID, FIX_ENVIRONMENT_ID), não há correção. */
  sandbox: FixSandbox | null;
  outbox: (orgId: string) => FixOutbox;
  recorder: RunRecorder;
  clock?: Clock;
}

// ---------- fix.json do agente, validado em código

export type FixTestResult = "passou" | "falhou" | "nao_rodou";

export interface FixReport {
  resumo: string;
  testes: { comando: string; resultado: FixTestResult };
}

/** Formato pedido ao agente. Resumo com linguagem de aprovação ou avaliação de pessoa é descartado. */
export function validFixReport(raw: unknown): FixReport | null {
  const r = raw as { resumo?: unknown; testes?: { comando?: unknown; resultado?: unknown } } | null;
  if (!r || typeof r !== "object" || typeof r.resumo !== "string" || !r.testes || typeof r.testes !== "object") return null;
  const resultado = r.testes.resultado;
  if (resultado !== "passou" && resultado !== "falhou" && resultado !== "nao_rodou") return null;
  const comando = typeof r.testes.comando === "string" ? cleanText(r.testes.comando, 200).replace(/`/g, "'") : "";
  const resumo = APPROVAL_PATTERN.test(r.resumo) || PEOPLE_PATTERN.test(r.resumo) ? "" : cleanText(r.resumo, 600);
  return { resumo, testes: { comando, resultado } };
}

const TESTS_LABEL: Record<FixTestResult, string> = { passou: "passaram", falhou: "falharam", nao_rodou: "não foram rodados" };

/** Texto do PR em rascunho, por regra. Identifica a análise automática e diz que não é aprovação. */
export function draftBody(input: { prNumber: number; findings: Finding[]; report: FixReport; baseSha: string }): string {
  const t = input.report.testes;
  return [
    `**Correção preparada pelo Echo** para o PR #${input.prNumber}, em rascunho, para aprovação do autor. Isto não é uma aprovação do PR #${input.prNumber} e não substitui a revisão de uma pessoa.`,
    "",
    "Achados tratados:",
    ...input.findings.map((f) => `- **${SEVERITY_LABEL[f.gravidade]}** · \`${f.arquivo}:${f.linha}\` · ${f.explicacao}`),
    "",
    ...(input.report.resumo ? [`O que mudou, segundo o agente: ${input.report.resumo}`, ""] : []),
    `Testes relatados pelo agente: ${TESTS_LABEL[t.resultado]}${t.comando ? ` (\`${t.comando}\`)` : ""}. A CI deste rascunho confirma o resultado.`,
    "",
    `_Feita pelo Claude em ambiente isolado sobre a versão ${input.baseSha.slice(0, 7)}. Powered by Claude._`,
  ].join("\n");
}

// ---------- Fluxo

export type FixOutcome =
  | { status: "draft_queued"; fixId: string; files: string[] }
  | { status: "skipped"; reason: string }
  | { status: "rejected" | "failed"; fixId?: string; reason: string };

export type FixDecisionOutcome =
  | { status: "approved" | "declined" }
  | { status: "denied" | "not_found" | "unavailable" | "conflict" }
  | { status: "refused"; reason: string };

const draftKey = (fixId: string) => `fix_draft:${fixId}`;
const mergeKey = (fixId: string) => `fix_merge:${fixId}`;
const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

export function createFix(deps: FixDeps) {
  const clock = deps.clock ?? systemClock;
  const record = (run: AgentRun) => deps.recorder.record(run).catch(() => undefined);

  /** Revisões que podem virar correção agora. Vazio sem ambiente ou sem a porta do GitHub. */
  async function pending(orgId: string): Promise<string[]> {
    if (!deps.sandbox || !deps.codeHost(orgId)) return [];
    return (await deps.fixes(orgId).candidates()).map((c) => c.reviewId);
  }

  async function run(orgId: string, reviewId: string): Promise<FixOutcome> {
    const started = performance.now();
    const base = (): AgentRun => ({ flow: "fix", orgId, durationMs: Math.round(performance.now() - started), result: "ok" });
    const host = deps.codeHost(orgId);
    if (!deps.sandbox || !host) {
      await record({ ...base(), result: "skipped", error: "sem ambiente ou sem GitHub" });
      return { status: "skipped", reason: "sem ambiente ou sem GitHub" };
    }
    const store = deps.fixes(orgId);
    const c = await store.candidate(reviewId);
    if (!c) return { status: "skipped", reason: "revisão sem achados ou já tratada" };

    const data = deps.data(orgId);
    const now = clock.now();
    const settings = await data.orgSettings();
    const [spent, personSpent, target, openFix] = await Promise.all([
      data.spentUsdSince(monthStart(now)),
      c.pr.authorId ? store.personSpentUsdSince(c.pr.authorId, monthStart(now)) : Promise.resolve(0),
      host.target(c.pr.repository, c.pr.number),
      store.openFixForPr(c.prId),
    ]);
    const decision = fixDecision({ reviewHeadSha: c.headSha, findings: c.findings, target, costLevel: costLevel(spent, settings.monthlyLimitUsd), personSpentMonthUsd: personSpent, openFixForPr: openFix });
    if (decision.action === "skip") {
      // Teto de custo e correção aberta são passageiros: a revisão continua candidata.
      const temporary = decision.reason === "teto_empresa" || decision.reason === "teto_pessoa" || decision.reason === "correcao_aberta";
      if (!temporary) await store.skip(reviewId, decision.reason);
      await record({ ...base(), result: "skipped", error: decision.reason });
      return { status: "skipped", reason: decision.reason };
    }

    const fix = await store.start(reviewId, { baseSha: c.headSha, branch: fixBranch(c.pr.number), findings: decision.findings });
    if (!fix) return { status: "skipped", reason: "revisão já tem correção" };
    const fail = async (state: "rejected" | "failed", reason: string, extra: Partial<AgentRun> & { sessionId?: string; costUsd?: number } = {}) => {
      const { sessionId, ...runExtra } = extra;
      await store.finish(fix.id, { state, error: reason, ...(sessionId ? { sessionId } : {}), ...(extra.costUsd !== undefined ? { costUsd: extra.costUsd } : {}) });
      await record({ ...base(), ...runExtra, result: state === "rejected" ? "refused" : "failed", error: reason, tools: ["managed_agents.session"] });
      return { status: state, fixId: fix.id, reason } as const;
    };

    let result: FixSandboxResult;
    try {
      const token = await host.readToken(c.pr.repository);
      result = await deps.sandbox.run({
        title: `Echo · correção do PR ${c.pr.number}`,
        repository: c.pr.repository,
        headSha: c.headSha,
        token,
        pr: { number: c.pr.number, title: c.pr.title, branch: c.pr.branch },
        findings: decision.findings,
        prFiles: c.files,
        budgetUsd: decision.budgetUsd,
      });
    } catch (err) {
      return fail("failed", err instanceof Error ? err.message : String(err), { model: MODELS.fix });
    }
    const usage = { model: MODELS.fix, costUsd: result.costUsd, sessionId: result.sessionId, ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}), ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}) };

    if (result.outcome !== "done") {
      const why = result.outcome === "budget_reached" ? `limite de US$ ${decision.budgetUsd.toFixed(2)} da correção atingido` : result.outcome === "timeout" ? "tempo esgotado no ambiente" : (result.error ?? "a sessão falhou");
      return fail("failed", why, usage);
    }
    const report = validFixReport(result.fixJson);
    if (!result.diff || !report) return fail("rejected", "o agente não devolveu diff e fix.json válidos", usage);
    // Conferência fora do ambiente: até 5 arquivos, só do PR ou de teste, sem CI, dependências ou segredos.
    const check = checkFixDiff(result.diff, c.files);
    if (!check.ok) return fail("rejected", `diff recusado: ${check.reasons.join("; ")}`, usage);

    await store.finish(fix.id, { state: "draft_queued", sessionId: result.sessionId, files: check.files, tests: report.testes.resultado, costUsd: result.costUsd });
    await deps.outbox(orgId).enqueue({
      type: "github.draft_pr",
      target: `github:${c.pr.repository}#${c.pr.number}`,
      // Mesma convenção de ActionPayloads (#7): repositório em `repo`. O executor de draft_pr ainda é de Integrações.
      payload: {
        repo: c.pr.repository,
        prNumber: c.pr.number,
        base: c.pr.branch,
        baseSha: c.headSha,
        branch: fixBranch(c.pr.number),
        title: `Correção do Echo para o PR #${c.pr.number}`,
        body: draftBody({ prNumber: c.pr.number, findings: decision.findings, report, baseSha: c.headSha }),
        patch: result.diff,
        draft: true,
      },
      idempotencyKey: draftKey(fix.id),
    });
    const { sessionId: _s, ...runUsage } = usage;
    await record({ ...base(), ...runUsage, tools: ["managed_agents.session", "github.draft_pr"] });
    return { status: "draft_queued", fixId: fix.id, files: check.files };
  }

  /** Rascunho aberto pelo outbox → correção pronta; união executada → aplicada. */
  async function sync(orgId: string): Promise<{ ready: number; applied: number; failed: number }> {
    const out = { ready: 0, applied: 0, failed: 0 };
    const store = deps.fixes(orgId);
    for (const fix of await store.inState("draft_queued")) {
      const r = await store.outboxResult(draftKey(fix.id));
      const draft = r?.result as { number?: unknown; headSha?: unknown } | null | undefined;
      if (r?.state === "done" && typeof draft?.number === "number" && typeof draft.headSha === "string") {
        if (await store.markReady(fix.id, { number: draft.number, headSha: draft.headSha })) {
          out.ready++;
          await record({ flow: "fix_ready", orgId, durationMs: 0, result: "ok" });
        }
      } else if (r?.state === "failed") {
        if (await store.markFailed(fix.id, "draft_queued", `rascunho não criado: ${r.error ?? "erro"}`)) out.failed++;
        await record({ flow: "fix_ready", orgId, durationMs: 0, result: "failed", error: r.error ?? "rascunho não criado" });
      }
    }
    for (const fix of await store.inState("approved")) {
      const r = await store.outboxResult(mergeKey(fix.id));
      if (r?.state === "done") {
        if (await store.markApplied(fix.id)) {
          out.applied++;
          await record({ flow: "fix_applied", orgId, durationMs: 0, result: "ok" });
        }
      } else if (r?.state === "failed") {
        if (await store.markFailed(fix.id, "approved", `união não feita: ${r.error ?? "erro"}`)) out.failed++;
        await record({ flow: "fix_applied", orgId, durationMs: 0, result: "failed", error: r.error ?? "união não feita" });
      }
    }
    return out;
  }

  /**
   * Meu plano: o autor aprova ou recusa. Aprovar confere, na hora, que o rascunho não mudou e enfileira a
   * união com a aprovação registrada; a versão do rascunho vai junto, e a execução recusa se ela mudar.
   */
  async function decide(orgId: string, by: string, fixId: string, decision: "approve" | "decline"): Promise<FixDecisionOutcome> {
    const started = performance.now();
    const finish = (outcome: FixDecisionOutcome, result: AgentRun["result"], tools: string[] = []) =>
      record({ flow: "fix_decision", orgId, durationMs: Math.round(performance.now() - started), result, tools, ...("reason" in outcome ? { error: outcome.reason } : {}) }).then(() => outcome);
    const store = deps.fixes(orgId);
    const fix = await store.get(fixId);
    if (!fix) return { status: "not_found" };
    if (!fix.pr.authorId || by !== fix.pr.authorId) return finish({ status: "denied" }, "refused");

    if (decision === "decline") {
      if (!(await store.decide(fixId, by, "declined", clock.now()))) return finish({ status: "conflict" }, "skipped");
      return finish({ status: "declined" }, "ok");
    }
    const host = deps.codeHost(orgId);
    if (!host) return finish({ status: "unavailable" }, "skipped");
    const [draft, pr] = await Promise.all([
      fix.draftPrNumber ? host.pull(fix.pr.repository, fix.draftPrNumber) : Promise.resolve(null),
      host.pull(fix.pr.repository, fix.pr.number),
    ]);
    const check = fixMergeCheck({ by, authorId: fix.pr.authorId, fixState: fix.state, draftHeadSha: fix.draftHeadSha, draft, pr });
    if (!check.ok) return finish({ status: "refused", reason: check.reason }, "refused");
    if (!(await store.decide(fixId, by, "approved", clock.now()))) return finish({ status: "conflict" }, "skipped");
    await deps.outbox(orgId).enqueue({
      type: "github.merge_fix",
      target: `github:${fix.pr.repository}#${fix.draftPrNumber}`,
      payload: { repo: fix.pr.repository, number: fix.draftPrNumber, sha: fix.draftHeadSha, base: fix.pr.branch, prNumber: fix.pr.number },
      idempotencyKey: mergeKey(fixId),
      approvedBy: by,
    });
    return finish({ status: "approved" }, "ok", ["github.merge_fix"]);
  }

  return { pending, run, sync, decide };
}

export type Fix = ReturnType<typeof createFix>;
