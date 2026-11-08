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

/**
 * Branch em que o rascunho pode ser escrito (com força, se já existir): só a do Echo para este PR
 * (`echo/fix-pr-N`), nunca a branch do PR original nem a padrão. Conferida no executor, antes de chamar o GitHub.
 */
export function fixDraftBranchCheck(input: { branch: string; base: string; prNumber: number; defaultBranch?: string }): { ok: true } | { ok: false; reason: string } {
  const { branch } = input;
  if (!branch.startsWith(FIX_RULES.branchPrefix)) return { ok: false, reason: `branch ${branch} não é do Echo (${FIX_RULES.branchPrefix}…)` };
  if (branch === input.base || branch === input.defaultBranch) return { ok: false, reason: `branch ${branch} é a base ou a padrão` };
  if (!Number.isInteger(input.prNumber) || input.prNumber <= 0 || branch !== fixBranch(input.prNumber)) return { ok: false, reason: `branch ${branch} não é a do PR #${input.prNumber}` };
  return { ok: true };
}

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

/** Cabeçalho de arquivo aceito. Qualquer outra linha que comece com "diff --git " recusa o diff inteiro. */
const FILE_HEADER = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** Linhas de cabeçalho de arquivo que o git escreve entre "diff --git" e o primeiro trecho. */
const META_LINE = /^(index |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |--- |\+\+\+ |Binary files )/;

/** Arquivo do diff com os trechos (@@ … e o que vem depois), lidos na mesma passada. */
export interface ParsedDiffFile extends DiffFile {
  hunks: string[];
}

export interface ParsedDiff {
  files: ParsedDiffFile[];
  /** Problemas de formato. Qualquer um recusa o diff inteiro (conferência e aplicação). */
  errors: string[];
}

/**
 * Lê um diff unificado do git numa só passada: caminho, status, contagem e trechos saem do mesmo cabeçalho.
 * Estrito: texto antes do primeiro cabeçalho, cabeçalho "diff --git" fora do formato, linha solta fora de trecho
 * e trecho cuja contagem (@@ -a,b +c,d @@) não bate com as linhas viram erro. Caminho entre aspas fica como
 * está e é recusado depois.
 */
export function readUnifiedDiff(patch: string): ParsedDiff {
  const files: ParsedDiffFile[] = [];
  const errors: string[] = [];
  let cur: ParsedDiffFile | null = null;
  /** Linhas que ainda faltam no trecho aberto (antigas e novas). */
  let oldLeft = 0;
  let newLeft = 0;
  let inHunk = false;
  /** Logo depois do fim de um trecho, "\ No newline at end of file" ainda é dele. */
  let afterHunk = false;
  /** Depois de "GIT binary patch", o corpo é binário até o próximo arquivo (o arquivo é recusado). */
  let binaryBody = false;
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  // A última quebra de linha do diff gera uma linha vazia que não é conteúdo.
  if (lines.at(-1) === "") lines.pop();
  const closeHunk = (n: number) => {
    if (inHunk && (oldLeft !== 0 || newLeft !== 0)) errors.push(`trecho incompleto em ${cur?.path || "?"} (linha ${n}): faltam ${oldLeft} linha(s) antigas e ${newLeft} novas`);
    inHunk = false;
  };
  lines.forEach((line, i) => {
    const n = i + 1;
    if (inHunk) {
      const c = line[0];
      if (c === "\\") { cur!.hunks.push(line); return; }
      if (c === " " || line === "" || c === "-" || c === "+") {
        if (c === "+") { if (newLeft === 0) { errors.push(`trecho com linhas a mais em ${cur!.path} (linha ${n})`); inHunk = false; return; } newLeft--; cur!.additions++; }
        else if (c === "-") { if (oldLeft === 0) { errors.push(`trecho com linhas a mais em ${cur!.path} (linha ${n})`); inHunk = false; return; } oldLeft--; cur!.deletions++; }
        else { if (oldLeft === 0 || newLeft === 0) { errors.push(`trecho com linhas a mais em ${cur!.path} (linha ${n})`); inHunk = false; return; } oldLeft--; newLeft--; }
        cur!.hunks.push(line);
        if (oldLeft === 0 && newLeft === 0) { inHunk = false; afterHunk = true; }
        return;
      }
      closeHunk(n);
    }
    if (line.startsWith("diff --git ")) {
      afterHunk = false;
      binaryBody = false;
      const header = FILE_HEADER.exec(line);
      if (!header) {
        errors.push(`cabeçalho de arquivo inválido na linha ${n}`);
        cur = null;
        return;
      }
      cur = { path: unquote(header[2]!), oldPath: unquote(header[1]!), status: "modified", additions: 0, deletions: 0, binary: false, modeChange: false, hunks: [] };
      files.push(cur);
      return;
    }
    if (!cur) {
      // Nada antes do primeiro cabeçalho válido; depois de um cabeçalho inválido, o erro já foi registrado.
      if (line.trim() !== "" && errors.length === 0) errors.push(`texto antes do primeiro arquivo na linha ${n}`);
      return;
    }
    if (binaryBody) return;
    if (line.startsWith("\\") && afterHunk) { cur.hunks.push(line); return; }
    afterHunk = false;
    const hunk = HUNK_HEADER.exec(line);
    if (line.startsWith("@@")) {
      if (!hunk) { errors.push(`trecho inválido na linha ${n}`); return; }
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2]);
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4]);
      cur.hunks.push(line);
      inHunk = oldLeft > 0 || newLeft > 0;
      if (!inHunk) errors.push(`trecho vazio na linha ${n}`);
      return;
    }
    if (line === "") return;
    if (line.startsWith("GIT binary patch")) { cur.binary = true; binaryBody = true; return; }
    if (!META_LINE.test(line)) { errors.push(`linha fora de trecho em ${cur.path} (linha ${n})`); return; }
    if (cur.hunks.length > 0) { errors.push(`cabeçalho depois dos trechos em ${cur.path} (linha ${n})`); return; }
    if (line.startsWith("new file mode")) cur.status = "added";
    else if (line.startsWith("deleted file mode")) cur.status = "deleted";
    else if (line.startsWith("rename from ")) { cur.status = "renamed"; cur.oldPath = line.slice(12).trim(); }
    else if (line.startsWith("rename to ")) cur.path = line.slice(10).trim();
    else if (line.startsWith("copy from ") || line.startsWith("copy to ")) errors.push(`cópia de arquivo em ${cur.path}`);
    else if (line.startsWith("old mode") || line.startsWith("new mode")) cur.modeChange = true;
    else if (line.startsWith("Binary files")) cur.binary = true;
    else if (line.startsWith("+++ ") && line.slice(4).trim() !== "/dev/null") cur.path = unquote(line.slice(4).replace(/^b\//, ""));
  });
  closeHunk(lines.length);
  return { files, errors };
}

/** Lê um diff unificado do git (só os metadados de cada arquivo). */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  return readUnifiedDiff(patch).files.map(({ hunks: _h, ...f }) => f);
}

export type FixCheck = { ok: true; files: string[]; changedLines: number } | { ok: false; reasons: string[] };

const badPath = (p: string) => p === "" || p.startsWith("/") || p.includes("\\") || p.includes('"') || p.split("/").some((s) => s === ".." || s === ".git");

/**
 * O diff do agente só passa se: até 5 arquivos, cada um do PR ou de teste, nenhum de CI, dependência ou segredo,
 * sem binário, remoção, renomeação ou mudança de permissão, e correção pequena. Arquivo novo, só de teste.
 */
export function checkFixDiff(patch: string, prFiles: readonly string[]): FixCheck {
  const parsed = readUnifiedDiff(patch);
  // Formato fora do padrão recusa tudo: o que se confere aqui tem de ser exatamente o que se aplica depois.
  if (parsed.errors.length) return { ok: false, reasons: parsed.errors.map((e) => `diff malformado: ${e}`) };
  const files = parsed.files;
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

// ---------- Aplicação do diff conferido (para o rascunho)

export interface FilePatch {
  path: string;
  status: DiffFile["status"];
  /** Linhas dos trechos (@@ … e o que vem depois), sem o cabeçalho do arquivo. */
  hunks: string[];
}

/**
 * Separa o diff unificado por arquivo, com os trechos de cada um, pela mesma leitura de `checkFixDiff`
 * (caminho e trechos vêm do mesmo cabeçalho, sem parear por posição). Diff malformado não é aplicado.
 */
export function splitUnifiedDiff(patch: string): FilePatch[] {
  const { files, errors } = readUnifiedDiff(patch);
  if (errors.length) throw new PatchConflictError(`diff malformado: ${errors.join("; ")}`);
  return files.map((f) => ({ path: f.path, status: f.status, hunks: f.hunks }));
}

export class PatchConflictError extends Error {
  override name = "PatchConflictError";
}

/**
 * Aplica os trechos de um arquivo sobre o conteúdo original. Cada linha de contexto e de remoção tem de bater
 * exatamente com o original, na posição do cabeçalho do trecho; se não bater, nada é aplicado (o rascunho falha).
 */
export function applyFilePatch(original: string, hunks: readonly string[]): string {
  const endsWithNewline = original === "" || original.endsWith("\n");
  const src = original === "" ? [] : (endsWithNewline ? original.slice(0, -1) : original).split("\n");
  const out: string[] = [];
  let pos = 0;
  let noNewlineAtEnd = !endsWithNewline;
  let i = 0;
  while (i < hunks.length) {
    const head = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(hunks[i]!);
    if (!head) throw new PatchConflictError(`trecho inválido: ${hunks[i]}`);
    const oldStart = Number(head[1]);
    const oldCount = head[2] === undefined ? 1 : Number(head[2]);
    // Com 0 linhas antigas, o número é a linha DEPOIS da qual se insere.
    const start = oldCount === 0 ? oldStart : oldStart - 1;
    if (start < pos || start > src.length) throw new PatchConflictError(`trecho fora do arquivo: ${hunks[i]}`);
    out.push(...src.slice(pos, start));
    pos = start;
    i++;
    let last: "old" | "new" | "both" = "both";
    while (i < hunks.length && !hunks[i]!.startsWith("@@")) {
      const line = hunks[i]!;
      const body = line.slice(1);
      if (line.startsWith(" ") || line === "") {
        if (src[pos] !== (line === "" ? "" : body)) throw new PatchConflictError(`contexto não bate na linha ${pos + 1}`);
        out.push(src[pos]!);
        pos++;
        last = "both";
      } else if (line.startsWith("-")) {
        if (src[pos] !== body) throw new PatchConflictError(`remoção não bate na linha ${pos + 1}`);
        pos++;
        last = "old";
      } else if (line.startsWith("+")) {
        out.push(body);
        last = "new";
      } else if (line.startsWith("\\")) {
        // "\ No newline at end of file" vale para a linha anterior: original, nova ou as duas.
        if (last !== "old") noNewlineAtEnd = true;
        if (last === "old") noNewlineAtEnd = false;
      }
      i++;
    }
  }
  out.push(...src.slice(pos));
  if (out.length === 0) return "";
  return out.join("\n") + (noNewlineAtEnd ? "" : "\n");
}
