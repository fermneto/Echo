// Regras da correção (etapa 10, F4 passos 4 a 6). Puras: sem relógio, rede nem modelo.
// Decidem quais achados viram correção, conferem o diff devolvido pelo agente fora do ambiente e só deixam
// unir o rascunho com a aprovação do autor, se o rascunho não mudou.
import { type CostLevel } from "./rules.ts";
import type { FindingSeverity } from "./night.ts";
import type { PrState } from "./types.ts";

export const FIX_RULES = {
  /** Só achado de alta confiança vira correção. */
  minConfidence: 0.8,
  severities: ["alta", "media"] as readonly FindingSeverity[],
  /** Achados enviados ao agente por correção. */
  maxFindings: 3,
  /** Correção pequena: até 5 arquivos e poucas linhas. */
  maxFiles: 5,
  maxChangedLines: 150,
  /** Limites em dólar (Configuração → Limites de custo). */
  perFixUsd: 2,
  personMonthUsd: 10,
  /** Abaixo disto, não vale abrir o ambiente. */
  minBudgetUsd: 0.5,
  branchPrefix: "echo/fix-pr-",
  testPaths: [
    /(^|\/)(__tests__|tests?|specs?)\//i,
    /\.(test|spec)\.[cm]?[jt]sx?$/i,
    /_test\.(go|py|rb)$/i,
    /(^|\/)test_[^/]+\.py$/i,
    /Tests?\.(java|kt|cs)$/,
  ],
  forbidden: {
    ci: [/(^|\/)\.github\//i, /(^|\/)\.gitlab-ci\.ya?ml$/i, /(^|\/)\.circleci\//i, /(^|\/)Jenkinsfile$/i, /(^|\/)azure-pipelines\.ya?ml$/i, /(^|\/)bitbucket-pipelines\.yml$/i, /(^|\/)render\.ya?ml$/i, /(^|\/)Dockerfile[^/]*$/i, /(^|\/)infra\//i],
    dependencies: [
      /(^|\/)package\.json$/i,
      /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?|\.npmrc|\.yarnrc(\.yml)?)$/i,
      /(^|\/)(requirements[^/]*\.txt|Pipfile(\.lock)?|poetry\.lock|pyproject\.toml|setup\.py|setup\.cfg|uv\.lock)$/i,
      /(^|\/)(go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|Gemfile(\.lock)?|composer\.(json|lock)|pom\.xml|build\.gradle(\.kts)?|gradle\.properties|.+\.csproj|packages\.lock\.json)$/i,
    ],
    secrets: [/(^|\/)\.env(\.|$)/i, /\.(pem|key|p12|pfx|jks|keystore)$/i, /(^|\/)(id_rsa|id_ed25519)[^/]*$/i, /(^|\/)(secrets?|credentials?)(\/|\.|$)/i, /(^|\/)\.aws\//i, /(^|\/)\.ssh\//i],
  },
} as const;

export const fixBranch = (prNumber: number) => `${FIX_RULES.branchPrefix}${prNumber}`;
export const isTestPath = (path: string) => FIX_RULES.testPaths.some((r) => r.test(path));

// ---------- Quais achados viram correção

export interface FixableFinding {
  arquivo: string;
  linha: number;
  gravidade: FindingSeverity;
  confianca: number;
}

/** O PR como está agora no GitHub (porta CodeHost). */
export interface FixTarget {
  state: PrState;
  headSha: string;
  /** Repositório de onde vem a branch do PR; diferente do repositório base = fork. */
  headRepository: string;
  repository: string;
  branch: string;
  defaultBranch: string;
}

export type FixSkipReason =
  | "sem_achado_elegivel"
  | "pr_nao_encontrado"
  | "pr_fechado"
  | "fork"
  | "branch_padrao"
  | "versao_alterada"
  | "correcao_aberta"
  | "teto_empresa"
  | "teto_pessoa";

export type FixDecision<F extends FixableFinding> = { action: "fix"; findings: F[]; budgetUsd: number } | { action: "skip"; reason: FixSkipReason };

/** Quanto a próxima correção pode gastar: US$ 2, ou o que falta dos US$ 10 da pessoa no mês. Zero = não roda. */
export function fixBudgetUsd(personSpentMonthUsd: number): number {
  const left = Math.min(FIX_RULES.perFixUsd, FIX_RULES.personMonthUsd - personSpentMonthUsd);
  return left >= FIX_RULES.minBudgetUsd ? Math.floor(left * 100) / 100 : 0;
}

/**
 * Só achados de alta confiança (alta ou média gravidade), num PR aberto que não é de fork nem a branch padrão,
 * e na mesma versão que foi analisada. Para em 80% do limite da empresa e no limite mensal da pessoa.
 */
export function fixDecision<F extends FixableFinding>(input: {
  reviewHeadSha: string;
  findings: readonly F[];
  target: FixTarget | null;
  costLevel: CostLevel;
  personSpentMonthUsd: number;
  /** Já existe correção desta PR esperando decisão (a branch echo/fix-pr-N está em uso). */
  openFixForPr: boolean;
}): FixDecision<F> {
  if (input.costLevel !== "normal") return { action: "skip", reason: "teto_empresa" };
  const findings = input.findings
    .filter((f) => f.confianca >= FIX_RULES.minConfidence && FIX_RULES.severities.includes(f.gravidade))
    .slice(0, FIX_RULES.maxFindings);
  if (findings.length === 0) return { action: "skip", reason: "sem_achado_elegivel" };
  const t = input.target;
  if (!t) return { action: "skip", reason: "pr_nao_encontrado" };
  if (t.state !== "open") return { action: "skip", reason: "pr_fechado" };
  if (t.headRepository.toLowerCase() !== t.repository.toLowerCase()) return { action: "skip", reason: "fork" };
  if (t.branch === t.defaultBranch) return { action: "skip", reason: "branch_padrao" };
  if (t.headSha !== input.reviewHeadSha) return { action: "skip", reason: "versao_alterada" };
  if (input.openFixForPr) return { action: "skip", reason: "correcao_aberta" };
  const budgetUsd = fixBudgetUsd(input.personSpentMonthUsd);
  if (budgetUsd === 0) return { action: "skip", reason: "teto_pessoa" };
  return { action: "fix", findings, budgetUsd };
}

// ---------- Conferência do diff, fora do ambiente

export interface DiffFile {
  path: string;
  oldPath: string;
  status: "modified" | "added" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  binary: boolean;
  modeChange: boolean;
}

const unquote = (p: string) => p.trim();

/** Lê um diff unificado do git. Caminho entre aspas (caracteres especiais) fica como está e é recusado depois. */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let inHunk = false;
  for (const line of patch.replace(/\r\n/g, "\n").split("\n")) {
    const header = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/.exec(line);
    if (header) {
      cur = { path: unquote(header[2]!), oldPath: unquote(header[1]!), status: "modified", additions: 0, deletions: 0, binary: false, modeChange: false };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("@@")) {
      inHunk = true;
      continue;
    }
    if (inHunk) {
      if (line.startsWith("+")) cur.additions++;
      else if (line.startsWith("-")) cur.deletions++;
      else if (!line.startsWith(" ") && !line.startsWith("\\") && line !== "") inHunk = false;
      if (inHunk) continue;
    }
    if (line.startsWith("new file mode")) cur.status = "added";
    else if (line.startsWith("deleted file mode")) cur.status = "deleted";
    else if (line.startsWith("rename from ")) { cur.status = "renamed"; cur.oldPath = line.slice(12).trim(); }
    else if (line.startsWith("rename to ")) cur.path = line.slice(10).trim();
    else if (line.startsWith("old mode") || line.startsWith("new mode")) cur.modeChange = true;
    else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) cur.binary = true;
    else if (line.startsWith("+++ ") && line.slice(4).trim() !== "/dev/null") cur.path = unquote(line.slice(4).replace(/^b\//, ""));
  }
  return files;
}

export type FixCheck = { ok: true; files: string[]; changedLines: number } | { ok: false; reasons: string[] };

const badPath = (p: string) => p === "" || p.startsWith("/") || p.includes("\\") || p.includes('"') || p.split("/").some((s) => s === ".." || s === ".git");

/**
 * O diff do agente só passa se: até 5 arquivos, cada um do PR ou de teste, nenhum de CI, dependência ou segredo,
 * sem binário, remoção, renomeação ou mudança de permissão, e correção pequena. Arquivo novo, só de teste.
 */
export function checkFixDiff(patch: string, prFiles: readonly string[]): FixCheck {
  const files = parseUnifiedDiff(patch);
  if (files.length === 0) return { ok: false, reasons: ["diff vazio"] };
  const reasons: string[] = [];
  const inPr = new Set(prFiles);
  if (new Set(files.map((f) => f.path)).size !== files.length) reasons.push("arquivo repetido no diff");
  if (files.length > FIX_RULES.maxFiles) reasons.push(`${files.length} arquivos (limite ${FIX_RULES.maxFiles})`);
  for (const f of files) {
    if (badPath(f.path) || badPath(f.oldPath)) { reasons.push(`caminho inválido: ${f.path}`); continue; }
    const kind = (Object.keys(FIX_RULES.forbidden) as (keyof typeof FIX_RULES.forbidden)[]).find((k) => FIX_RULES.forbidden[k].some((r) => r.test(f.path)));
    if (kind) reasons.push(`${kind === "ci" ? "arquivo de CI" : kind === "dependencies" ? "arquivo de dependências" : "arquivo de segredo"}: ${f.path}`);
    if (f.binary) reasons.push(`arquivo binário: ${f.path}`);
    if (f.modeChange) reasons.push(`mudança de permissão: ${f.path}`);
    if (f.status === "deleted") reasons.push(`remoção de arquivo: ${f.path}`);
    if (f.status === "renamed") reasons.push(`renomeação: ${f.oldPath} → ${f.path}`);
    const test = isTestPath(f.path);
    if (f.status === "added" && !test) reasons.push(`arquivo novo fora de teste: ${f.path}`);
    else if (f.status !== "added" && !inPr.has(f.path) && !test) reasons.push(`arquivo fora do PR: ${f.path}`);
  }
  const changedLines = files.reduce((s, f) => s + f.additions + f.deletions, 0);
  if (changedLines === 0) reasons.push("diff sem linhas alteradas");
  if (changedLines > FIX_RULES.maxChangedLines) reasons.push(`${changedLines} linhas alteradas (limite ${FIX_RULES.maxChangedLines})`);
  return reasons.length ? { ok: false, reasons } : { ok: true, files: files.map((f) => f.path), changedLines };
}

// ---------- Aprovação do autor

export interface PullHead {
  state: "open" | "closed" | "merged";
  headSha: string;
}

export type FixMergeCheck = { ok: true } | { ok: false; reason: "so_o_autor" | "nao_esta_pronta" | "rascunho_mudou" | "rascunho_fechado" | "pr_fechado" };

/**
 * Só o autor do PR aprova; só correção pronta; o rascunho tem de estar aberto e na mesma versão que a
 * plataforma criou (ninguém empurrou nada depois); o PR original tem de seguir aberto.
 */
export function fixMergeCheck(input: { by: string; authorId: string | undefined; fixState: string; draftHeadSha: string | undefined; draft: PullHead | null; pr: PullHead | null }): FixMergeCheck {
  if (!input.authorId || input.by !== input.authorId) return { ok: false, reason: "so_o_autor" };
  if (input.fixState !== "ready" || !input.draftHeadSha) return { ok: false, reason: "nao_esta_pronta" };
  if (!input.draft || input.draft.state !== "open") return { ok: false, reason: "rascunho_fechado" };
  if (input.draft.headSha !== input.draftHeadSha) return { ok: false, reason: "rascunho_mudou" };
  if (!input.pr || input.pr.state !== "open") return { ok: false, reason: "pr_fechado" };
  return { ok: true };
}
