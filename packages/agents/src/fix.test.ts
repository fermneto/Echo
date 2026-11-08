// Correção (etapa 10): achados elegíveis, ambiente isolado, diff conferido fora dele, rascunho pelo outbox e
// união só com a aprovação do autor e o rascunho sem mudança.
import type { OutboxAction } from "@echo/actions";
import { FixedClock, type FixTarget, type PullHead } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import type { AgentData } from "./data.ts";
import { createFix, draftBody, FIX_APPROVE_ACTION_ID, FIX_DECLINE_ACTION_ID, fixClick, type FixCandidate, type FixCodeHost, type FixSandboxInput, type FixSandboxResult, type FixState, type FixStore, type StoredFix, validFixReport } from "./fix.ts";
import type { Finding } from "./night-review.ts";

const NOW = new Date("2026-11-09T06:00:00Z");
const finding: Finding = { arquivo: "src/filtros.ts", linha: 4, gravidade: "alta", explicacao: "SQL montada com concatenação.", sugestao: "Usar consulta parametrizada.", confianca: 0.92 };
const PATCH = ["diff --git a/src/filtros.ts b/src/filtros.ts", "--- a/src/filtros.ts", "+++ b/src/filtros.ts", "@@ -3,3 +3,3 @@", " export async function listar(db, filtro) {", "-  return db.query(`SELECT * FROM itens WHERE nome = '${filtro}'`);", "+  return db.query('SELECT * FROM itens WHERE nome = $1', [filtro]);", " }"].join("\n");
const REPORT = { resumo: "Consulta parametrizada no filtro.", testes: { comando: "pnpm test", resultado: "passou" } };

function setup(opts: { sandbox?: Partial<FixSandboxResult>; target?: Partial<FixTarget>; findings?: Finding[]; spent?: number; personSpent?: number; host?: boolean } = {}) {
  const candidates = new Map<string, FixCandidate>([
    ["rv1", { reviewId: "rv1", prId: "p44", pr: { repository: "org/app", number: 44, title: "Filtro da listagem", branch: "ech-128-filtro", authorId: "fernando" }, headSha: "sha44", files: ["src/filtros.ts"], findings: opts.findings ?? [finding] }],
  ]);
  const fixes = new Map<string, StoredFix & { reviewId: string; error?: string; decidedBy?: string }>();
  const skipped: string[] = [];
  const outboxRows = new Map<string, { state: string; result: unknown; error?: string }>();
  const outbox: OutboxAction[] = [];
  const sandboxCalls: FixSandboxInput[] = [];
  const pulls = new Map<number, PullHead>([[44, { state: "open", headSha: "sha44" }]]);
  const recorder = new LogRunRecorder();
  let seq = 0;

  const moveFix = (id: string, from: FixState[], patch: Partial<StoredFix>) => {
    const f = fixes.get(id);
    if (!f || !from.includes(f.state)) return false;
    Object.assign(f, patch);
    return true;
  };
  const store: FixStore = {
    candidates: async () => [...candidates.values()].filter((c) => ![...fixes.values()].some((f) => f.reviewId === c.reviewId) && !skipped.includes(c.reviewId)),
    candidate: async (id) => (await store.candidates()).find((c) => c.reviewId === id) ?? null,
    openFixForPr: async () => [...fixes.values()].some((f) => ["running", "draft_queued", "ready", "approved"].includes(f.state)),
    personSpentUsdSince: async () => opts.personSpent ?? 0,
    skip: async (id) => (skipped.push(id), true),
    start: async (reviewId, input) => {
      if ([...fixes.values()].some((f) => f.reviewId === reviewId)) return null;
      const c = candidates.get(reviewId)!;
      const id = `fix${++seq}`;
      fixes.set(id, { id, reviewId, pr: { repository: c.pr.repository, number: c.pr.number, branch: c.pr.branch, authorId: c.pr.authorId! }, state: "running", baseSha: input.baseSha, files: [] });
      return { id };
    },
    finish: async (id, r) => moveFix(id, ["running"], { state: r.state, ...(r.files ? { files: r.files } : {}), ...(r.tests ? { tests: r.tests } : {}), ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}), ...(r.error ? { error: r.error } : {}) } as Partial<StoredFix>),
    get: async (id) => fixes.get(id) ?? null,
    inState: async (s) => [...fixes.values()].filter((f) => f.state === s),
    outboxResult: async (key) => outboxRows.get(key) ?? null,
    markReady: async (id, d) => moveFix(id, ["draft_queued"], { state: "ready", draftPrNumber: d.number, draftHeadSha: d.headSha }),
    markFailed: async (id, from, error) => moveFix(id, [from], { state: "failed", error } as Partial<StoredFix>),
    decide: async (id, by, to) => moveFix(id, ["ready"], { state: to, decidedBy: by } as Partial<StoredFix>),
    markApplied: async (id) => moveFix(id, ["approved"], { state: "applied" }),
  };
  const host: FixCodeHost = {
    target: async () => ({ state: "open", headSha: "sha44", headRepository: "org/app", repository: "org/app", branch: "ech-128-filtro", defaultBranch: "main", ...opts.target }),
    readToken: async () => "tok-1h-leitura",
    pull: async (_r, n) => pulls.get(n) ?? null,
  };
  const data = { orgSettings: async () => ({ monthlyLimitUsd: 50 }), spentUsdSince: async () => opts.spent ?? 0 } as unknown as AgentData;
  const flow = createFix({
    data: () => data,
    fixes: () => store,
    codeHost: () => (opts.host === false ? null : host),
    personBySlackUser: async (_o, slackUserId) => (slackUserId === "UFER" ? "fernando" : null),
    sandbox: {
      run: async (input) => {
        sandboxCalls.push(input);
        return { sessionId: "sesn_1", outcome: "done", diff: PATCH, fixJson: REPORT, costUsd: 0.42, inputTokens: 90_000, outputTokens: 4_000, ...opts.sandbox };
      },
    },
    outbox: () => ({
      enqueue: async (a) => {
        if (outboxRows.has(a.idempotencyKey)) return { id: a.idempotencyKey, duplicate: true };
        outbox.push(a);
        outboxRows.set(a.idempotencyKey, { state: a.approvedBy ? "approved" : "pending", result: null });
        return { id: a.idempotencyKey, duplicate: false };
      },
    }),
    recorder,
    clock: new FixedClock(NOW),
  });
  return { flow, fixes, skipped, outbox, outboxRows, sandboxCalls, pulls, runs: recorder.runs };
}

describe("correção", () => {
  it("um erro plantado vira rascunho aprovável e é unido pela aprovação do autor", async () => {
    const s = setup();
    expect(await s.flow.pending("org")).toEqual(["rv1"]);
    const r = await s.flow.run("org", "rv1");
    expect(r).toEqual({ status: "draft_queued", fixId: "fix1", files: ["src/filtros.ts"] });

    // O ambiente recebe o token só leitura, a versão analisada e o limite de US$ 2.
    expect(s.sandboxCalls[0]).toMatchObject({ repository: "org/app", headSha: "sha44", token: "tok-1h-leitura", budgetUsd: 2, prFiles: ["src/filtros.ts"], findings: [finding] });
    // O rascunho vai pelo outbox, sem aprovação (não muda o PR), na branch echo/fix-pr-44.
    expect(s.outbox[0]).toMatchObject({ type: "github.draft_pr", idempotencyKey: "fix_draft:fix1", payload: { repo: "org/app", base: "ech-128-filtro", baseSha: "sha44", branch: "echo/fix-pr-44", patch: PATCH, draft: true } });
    expect(s.outbox[0]!.approvedBy).toBeUndefined();
    expect((s.outbox[0]!.payload as { body: string }).body).toMatch(/^\*\*Correção preparada pelo Echo\*\* para o PR #44, em rascunho, para aprovação do autor\. Isto não é uma aprovação/);
    expect(s.runs.at(-1)).toMatchObject({ flow: "fix", result: "ok", model: "claude-sonnet-5-5", costUsd: 0.42, tools: ["managed_agents.session", "github.draft_pr"] });

    // A execução do outbox devolve o rascunho: correção pronta.
    s.outboxRows.set("fix_draft:fix1", { state: "done", result: { number: 45, headSha: "d45" } });
    expect(await s.flow.sync("org")).toEqual({ ready: 1, applied: 0, failed: 0 });
    s.pulls.set(45, { state: "open", headSha: "d45" });

    // Só o autor aprova; a união leva a versão do rascunho e a aprovação registrada.
    expect(await s.flow.decide("org", "eduardo", "fix1", "approve")).toEqual({ status: "denied" });
    expect(await s.flow.decide("org", "fernando", "fix1", "approve")).toEqual({ status: "approved" });
    // Rascunho pronto: o autor recebe Aplicar/Recusar no privado (sem aprovação: é só aviso).
    expect(s.outbox[1]).toMatchObject({ type: "slack.dm", idempotencyKey: "fix_ready_dm:fix1", payload: { personId: "fernando" } });
    expect(JSON.stringify(s.outbox[1]!.payload)).toContain("não é uma aprovação");
    expect(s.outbox[2]).toMatchObject({ type: "github.merge_fix", approvedBy: "fernando", approvalSource: "painel", idempotencyKey: "fix_merge:fix1", payload: { repo: "org/app", number: 45, sha: "d45", base: "ech-128-filtro" } });
    expect(await s.flow.decide("org", "fernando", "fix1", "approve")).toMatchObject({ status: "refused", reason: "nao_esta_pronta" });

    s.outboxRows.set("fix_merge:fix1", { state: "done", result: { merged: true } });
    expect(await s.flow.sync("org")).toEqual({ ready: 0, applied: 1, failed: 0 });
    expect(s.fixes.get("fix1")!.state).toBe("applied");
    expect(s.runs.map((x) => x.flow)).toEqual(["fix", "fix_ready", "fix_decision", "fix_decision", "fix_decision", "fix_applied"]);
  });

  it("rascunho que mudou depois de pronto não é unido", async () => {
    const s = setup();
    await s.flow.run("org", "rv1");
    s.outboxRows.set("fix_draft:fix1", { state: "done", result: { number: 45, headSha: "d45" } });
    await s.flow.sync("org");
    s.pulls.set(45, { state: "open", headSha: "outro-commit" });
    expect(await s.flow.decide("org", "fernando", "fix1", "approve")).toEqual({ status: "refused", reason: "rascunho_mudou" });
    expect(s.outbox.filter((a) => a.type === "github.merge_fix")).toEqual([]);
    expect(await s.flow.decide("org", "fernando", "fix1", "decline")).toEqual({ status: "declined" });
    expect(s.fixes.get("fix1")!.state).toBe("declined");
  });

  it("clique no Slack: só Aplicar/Recusar com id válido, e quem clica é a pessoa da conta do Slack", () => {
    const click = (action_id: string, value: string, user = "UFER") => ({ type: "block_actions", user: { id: user }, actions: [{ action_id, value }] });
    const id = "00000000-0000-4000-8000-000000000001";
    expect(fixClick(click(FIX_APPROVE_ACTION_ID, id))).toEqual({ slackUserId: "UFER", fixId: id, decision: "approve" });
    expect(fixClick(click(FIX_DECLINE_ACTION_ID, id))?.decision).toBe("decline");
    expect(fixClick(click("confirmar_nota", id))).toBeNull();
    expect(fixClick(click(FIX_APPROVE_ACTION_ID, "não é id"))).toBeNull();
  });

  it("Aplicar no Slack: a união leva a pessoa e a origem para o audit_log; conta sem pessoa é recusada e registrada", async () => {
    const s = setup();
    await s.flow.run("org", "rv1");
    // O rascunho leva os arquivos do PR: o executor confere o diff de novo antes de escrever.
    expect(s.outbox[0]!.payload).toMatchObject({ prFiles: ["src/filtros.ts"], branch: "echo/fix-pr-44" });
    s.outboxRows.set("fix_draft:fix1", { state: "done", result: { number: 45, headSha: "d45" } });
    await s.flow.sync("org");
    s.pulls.set(45, { state: "open", headSha: "d45" });
    const click = (user: string) => ({ type: "block_actions", user: { id: user }, actions: [{ action_id: FIX_APPROVE_ACTION_ID, value: "00000000-0000-4000-8000-000000000001" }] });

    const before = s.runs.length;
    expect(await s.flow.decideFromSlack("org", click("UOUTRO"))).toEqual({ status: "denied" });
    expect(s.runs.slice(before)).toMatchObject([{ flow: "fix_decision", result: "refused", error: "conta do Slack sem pessoa no Echo" }]);

    // O id do botão é um uuid; o store falso usa "fix1", então a decisão vai direto pelo fluxo com a origem Slack.
    expect(await s.flow.decide("org", "fernando", "fix1", "approve", "slack")).toEqual({ status: "approved" });
    expect(s.outbox.find((a) => a.type === "github.merge_fix")).toMatchObject({ approvedBy: "fernando", approvalSource: "slack" });
  });

  it("diff com arquivo fora do PR ou de CI é recusado, sem rascunho", async () => {
    const ci = ["diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml", "--- a/.github/workflows/ci.yml", "+++ b/.github/workflows/ci.yml", "@@ -1 +1 @@", "-a", "+b"].join("\n");
    const s = setup({ sandbox: { diff: `${PATCH}\n${ci}` } });
    expect(await s.flow.run("org", "rv1")).toMatchObject({ status: "rejected", reason: "diff recusado: arquivo de CI: .github/workflows/ci.yml; arquivo fora do PR: .github/workflows/ci.yml" });
    expect(s.outbox).toEqual([]);
    expect(s.fixes.get("fix1")!.state).toBe("rejected");
    expect(s.runs[0]).toMatchObject({ flow: "fix", result: "refused", costUsd: 0.42 });
  });

  it("sem fix.json válido, ou sessão no limite de custo, não há rascunho", async () => {
    const noJson = setup({ sandbox: { fixJson: { resumo: 1 } } });
    expect(await noJson.flow.run("org", "rv1")).toMatchObject({ status: "rejected", reason: "o agente não devolveu diff e fix.json válidos" });
    const budget = setup({ sandbox: { outcome: "budget_reached", diff: null, fixJson: null, costUsd: 2.01 } });
    expect(await budget.flow.run("org", "rv1")).toMatchObject({ status: "failed", reason: "limite de US$ 2.00 da correção atingido" });
    expect(budget.outbox).toEqual([]);
  });

  it("fica de fora: fork, versão alterada, achado de baixa confiança; para nos limites de custo", async () => {
    const fork = setup({ target: { headRepository: "alguem/app" } });
    expect(await fork.flow.run("org", "rv1")).toEqual({ status: "skipped", reason: "fork" });
    expect(fork.skipped).toEqual(["rv1"]);
    expect(fork.sandboxCalls).toEqual([]);
    expect(await setup({ target: { headSha: "sha45" } }).flow.run("org", "rv1")).toEqual({ status: "skipped", reason: "versao_alterada" });
    expect(await setup({ findings: [{ ...finding, confianca: 0.6 }] }).flow.run("org", "rv1")).toEqual({ status: "skipped", reason: "sem_achado_elegivel" });

    // 80% do limite da empresa (US$ 40 de 50) e limite da pessoa: passageiros, a revisão segue candidata.
    const org = setup({ spent: 40 });
    expect(await org.flow.run("org", "rv1")).toEqual({ status: "skipped", reason: "teto_empresa" });
    expect(org.skipped).toEqual([]);
    expect(await setup({ personSpent: 9.8 }).flow.run("org", "rv1")).toEqual({ status: "skipped", reason: "teto_pessoa" });
    const partial = setup({ personSpent: 9 });
    await partial.flow.run("org", "rv1");
    expect(partial.sandboxCalls[0]!.budgetUsd).toBe(1);
  });

  it("sem a porta do GitHub não há correção nem candidatos", async () => {
    const s = setup({ host: false });
    expect(await s.flow.pending("org")).toEqual([]);
    expect(await s.flow.run("org", "rv1")).toEqual({ status: "skipped", reason: "sem ambiente ou sem GitHub" });
  });
});

describe("fix.json e texto do rascunho", () => {
  it("resumo com linguagem de aprovação cai; o texto do rascunho é escrito por regra", () => {
    expect(validFixReport({ resumo: "Corrigido, pode fazer o merge.", testes: { comando: "pnpm `rm` test", resultado: "passou" } })).toEqual({ resumo: "", testes: { comando: "pnpm 'rm' test", resultado: "passou" } });
    expect(validFixReport({ resumo: "ok", testes: { resultado: "talvez" } })).toBeNull();
    const body = draftBody({ prNumber: 44, findings: [finding], report: { resumo: "", testes: { comando: "", resultado: "nao_rodou" } }, baseSha: "abcdef123" });
    expect(body).toContain("- **Alta** · `src/filtros.ts:4` · SQL montada com concatenação.");
    expect(body).toContain("Testes relatados pelo agente: não foram rodados. A CI deste rascunho confirma o resultado.");
    expect(body).toContain("versão abcdef1. Powered by Claude.");
    expect(body).not.toMatch(/agente de|resumo/i);
  });
});
