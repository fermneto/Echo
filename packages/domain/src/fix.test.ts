// Correção (etapa 10): achados elegíveis, conferência dos arquivos permitidos e união só se o rascunho não mudou.
import { describe, expect, it } from "vitest";
import { checkFixDiff, fixBudgetUsd, fixDecision, fixMergeCheck, type FixTarget, parseUnifiedDiff } from "./fix.ts";

const target = (extra: Partial<FixTarget> = {}): FixTarget => ({ state: "open", headSha: "sha1", headRepository: "org/app", repository: "org/app", branch: "ech-128", defaultBranch: "main", ...extra });
const alta = { arquivo: "src/a.ts", linha: 4, gravidade: "alta" as const, confianca: 0.9 };
const base = { reviewHeadSha: "sha1", findings: [alta], target: target(), costLevel: "normal" as const, personSpentMonthUsd: 0, openFixForPr: false };

const edit = (path: string, lines = ["-a", "+b"]) => [`diff --git a/${path} b/${path}`, "index 1..2 100644", `--- a/${path}`, `+++ b/${path}`, "@@ -1,3 +1,3 @@", " x", ...lines, " y"].join("\n");
const added = (path: string) => [`diff --git a/${path} b/${path}`, "new file mode 100644", "index 0..2", "--- /dev/null", `+++ b/${path}`, "@@ -0,0 +1,2 @@", "+it()", "+ok"].join("\n");

describe("fixDecision", () => {
  it("só achado de alta confiança e gravidade alta ou média, até 3", () => {
    const r = fixDecision({ ...base, findings: [{ ...alta, confianca: 0.79 }, { ...alta, gravidade: "baixa" }, alta, { ...alta, gravidade: "media", linha: 9 }, { ...alta, linha: 10 }, { ...alta, linha: 11 }] });
    expect(r).toEqual({ action: "fix", findings: [alta, { ...alta, gravidade: "media", linha: 9 }, { ...alta, linha: 10 }], budgetUsd: 2 });
    expect(fixDecision({ ...base, findings: [{ ...alta, confianca: 0.5 }] })).toEqual({ action: "skip", reason: "sem_achado_elegivel" });
  });

  it("PR de fork, branch padrão, fechado ou versão já alterada ficam de fora", () => {
    expect(fixDecision({ ...base, target: target({ headRepository: "fulano/app" }) })).toMatchObject({ reason: "fork" });
    expect(fixDecision({ ...base, target: target({ branch: "main" }) })).toMatchObject({ reason: "branch_padrao" });
    expect(fixDecision({ ...base, target: target({ headSha: "sha2" }) })).toMatchObject({ reason: "versao_alterada" });
    expect(fixDecision({ ...base, target: target({ state: "merged" }) })).toMatchObject({ reason: "pr_fechado" });
    expect(fixDecision({ ...base, target: null })).toMatchObject({ reason: "pr_nao_encontrado" });
    expect(fixDecision({ ...base, openFixForPr: true })).toMatchObject({ reason: "correcao_aberta" });
  });

  it("limites: para em 80% da empresa; US$ 2 por correção e o que falta dos US$ 10 da pessoa", () => {
    expect(fixDecision({ ...base, costLevel: "stop_fixes" })).toMatchObject({ reason: "teto_empresa" });
    expect(fixDecision({ ...base, personSpentMonthUsd: 9.7 })).toMatchObject({ reason: "teto_pessoa" });
    expect([0, 8.5, 9, 9.5, 9.51].map(fixBudgetUsd)).toEqual([2, 1.5, 1, 0.5, 0]);
  });
});

describe("checkFixDiff", () => {
  const prFiles = ["src/a.ts", "src/b.ts"];

  it("aceita arquivos do PR e testes, novos ou alterados", () => {
    const r = checkFixDiff([edit("src/a.ts"), added("src/a.test.ts"), edit("tests/integracao/b.spec.ts")].join("\n"), prFiles);
    expect(r).toEqual({ ok: true, files: ["src/a.ts", "src/a.test.ts", "tests/integracao/b.spec.ts"], changedLines: 6 });
  });

  it("recusa arquivo fora do PR, CI, dependência, segredo e arquivo novo fora de teste", () => {
    const r = checkFixDiff([edit("src/c.ts"), edit(".github/workflows/ci.yml"), edit("package.json"), edit(".env.production"), added("src/novo.ts")].join("\n"), [...prFiles, ".github/workflows/ci.yml", "package.json", ".env.production"]);
    expect(r).toEqual({ ok: false, reasons: ["arquivo fora do PR: src/c.ts", "arquivo de CI: .github/workflows/ci.yml", "arquivo de dependências: package.json", "arquivo de segredo: .env.production", "arquivo novo fora de teste: src/novo.ts"] });
  });

  it("até 5 arquivos, sem binário, remoção, renomeação, permissão ou caminho estranho, e correção pequena", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((n) => edit(`tests/${n}.test.ts`)).join("\n");
    expect(checkFixDiff(six, [])).toMatchObject({ ok: false, reasons: ["6 arquivos (limite 5)"] });
    const weird = [
      "diff --git a/src/a.ts b/src/a.ts\nold mode 100644\nnew mode 100755",
      "diff --git a/src/b.ts b/src/b.ts\ndeleted file mode 100644\n--- a/src/b.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x",
      "diff --git a/src/a.png b/src/a.png\nBinary files a/src/a.png and b/src/a.png differ",
      edit("src/../../etc/passwd"),
    ].join("\n");
    const r = checkFixDiff(weird, [...prFiles, "src/a.png"]);
    expect(r.ok === false && r.reasons).toEqual(["mudança de permissão: src/a.ts", "remoção de arquivo: src/b.ts", "arquivo binário: src/a.png", "caminho inválido: src/../../etc/passwd"]);
    const big = edit("src/a.ts", Array.from({ length: 151 }, (_, i) => `+linha ${i}`)).replace("@@ -1,3 +1,3 @@", "@@ -1,2 +1,153 @@");
    expect(checkFixDiff(big, prFiles)).toMatchObject({ ok: false, reasons: ["151 linhas alteradas (limite 150)"] });
    expect(checkFixDiff("", prFiles)).toEqual({ ok: false, reasons: ["diff vazio"] });
  });

  it("lê renomeação e conta linhas só dentro dos trechos", () => {
    const [f] = parseUnifiedDiff("diff --git a/src/a.ts b/src/z.ts\nsimilarity index 90%\nrename from src/a.ts\nrename to src/z.ts\n--- a/src/a.ts\n+++ b/src/z.ts\n@@ -1 +1 @@\n-a\n+b\n");
    expect(f).toMatchObject({ path: "src/z.ts", oldPath: "src/a.ts", status: "renamed", additions: 1, deletions: 1 });
  });
});

describe("fixMergeCheck", () => {
  const ok = { by: "fernando", authorId: "fernando", fixState: "ready", draftHeadSha: "d1", draft: { state: "open" as const, headSha: "d1" }, pr: { state: "open" as const, headSha: "sha1" } };
  it("une só com aprovação do autor e rascunho sem mudança", () => {
    expect(fixMergeCheck(ok)).toEqual({ ok: true });
    expect(fixMergeCheck({ ...ok, by: "eduardo" })).toEqual({ ok: false, reason: "so_o_autor" });
    expect(fixMergeCheck({ ...ok, draft: { state: "open", headSha: "d2" } })).toEqual({ ok: false, reason: "rascunho_mudou" });
    expect(fixMergeCheck({ ...ok, draft: { state: "closed", headSha: "d1" } })).toEqual({ ok: false, reason: "rascunho_fechado" });
    expect(fixMergeCheck({ ...ok, pr: { state: "merged", headSha: "sha1" } })).toEqual({ ok: false, reason: "pr_fechado" });
    expect(fixMergeCheck({ ...ok, fixState: "approved" })).toEqual({ ok: false, reason: "nao_esta_pronta" });
  });
});
