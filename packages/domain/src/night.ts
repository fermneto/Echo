// Regras da noite e da manhã (etapa 9, F4 e F5). Puras: recebem `now`, sem relógio, rede nem modelo.
// O filtro decide quais PRs vão para o lote; o plano da manhã sai inteiro daqui, com motivo escrito por regra.
import { isAway } from "./rules.ts";
import { addDays, DAY, HOUR, localDate, MINUTE, weekdayOf, zonedTime } from "./time.ts";
import type { Absence, Person, PullRequest, Task } from "./types.ts";

export const NIGHT_RULES = {
  /** Acima disto, o PR é grande demais para análise automática e recebe só o aviso. */
  maxFiles: 80,
  maxChangedLines: 3000,
  /** Cerca de 75 mil tokens de diff (a Calculadora usa 100 mil de entrada por revisão). */
  maxDiffChars: 300_000,
  /** PR sensível ou grande vai para o Opus. */
  opusChangedLines: 1000,
  sensitivePaths: [/(^|\/)(auth|autenticacao|login|seguranca|security|pagamentos?|payments?|billing|cobranca)(\/|\.|$)/i, /(^|\/)migrations?\//i, /(^|\/)\.github\/workflows\//i, /(^|\/)infra\//i, /(^|\/)\.env/i],
  /** Achado abaixo desta confiança não vai para o comentário. */
  minConfidence: 0.5,
  maxFindingsInComment: 10,
} as const;

export const MORNING_RULES = {
  maxItems: 7,
  /** O plano sai a partir de 30 min antes do expediente e até 2 h depois do início (worker parado). */
  leadMinutes: 30,
  lateHours: 2,
  dueSoonDays: 3,
} as const;

// ---------- Filtro da revisão noturna

export interface PrDiffSummary {
  headSha: string;
  files: { path: string; additions: number; deletions: number }[];
  /** Tamanho do diff em caracteres (sem truncar). */
  totalChars: number;
}

export type ReviewDecision =
  | { action: "review"; model: "sonnet" | "opus"; reason: string }
  | { action: "skip"; reason: "rascunho" | "fechado" | "sem_mudanca" | "ja_revisado" }
  | { action: "too_large"; reason: string };

/**
 * Pula rascunho, PR fechado, PR sem mudança e versão (head) já revisada. PR grande demais não vai para o
 * lote: recebe o aviso de que não houve análise. Sensível (caminhos de risco) ou grande vai para o Opus.
 */
export function reviewDecision(pr: Pick<PullRequest, "state">, diff: PrDiffSummary, reviewedShas: readonly string[]): ReviewDecision {
  if (pr.state === "draft") return { action: "skip", reason: "rascunho" };
  if (pr.state !== "open") return { action: "skip", reason: "fechado" };
  if (reviewedShas.includes(diff.headSha)) return { action: "skip", reason: "ja_revisado" };
  const changed = diff.files.reduce((s, f) => s + f.additions + f.deletions, 0);
  if (diff.files.length === 0 || changed === 0) return { action: "skip", reason: "sem_mudanca" };
  if (diff.files.length > NIGHT_RULES.maxFiles) return { action: "too_large", reason: `${diff.files.length} arquivos (limite ${NIGHT_RULES.maxFiles})` };
  if (changed > NIGHT_RULES.maxChangedLines) return { action: "too_large", reason: `${changed} linhas alteradas (limite ${NIGHT_RULES.maxChangedLines})` };
  if (diff.totalChars > NIGHT_RULES.maxDiffChars) return { action: "too_large", reason: "diff acima do limite de tamanho" };
  const sensitive = diff.files.find((f) => NIGHT_RULES.sensitivePaths.some((r) => r.test(f.path)));
  if (sensitive) return { action: "review", model: "opus", reason: `caminho sensível: ${sensitive.path}` };
  if (changed > NIGHT_RULES.opusChangedLines) return { action: "review", model: "opus", reason: `${changed} linhas alteradas` };
  return { action: "review", model: "sonnet", reason: `${changed} linhas alteradas` };
}

export type FindingSeverity = "alta" | "media" | "baixa";
const SEVERITY_ORDER: Record<FindingSeverity, number> = { alta: 0, media: 1, baixa: 2 };
export const severityRank = (s: FindingSeverity) => SEVERITY_ORDER[s];

// ---------- Agenda da manhã

/** Data local de hoje se agora está entre 30 min antes do expediente e 2 h depois do início. Férias: nada. */
export function morningDue(person: Person, absences: Absence[], now: Date): { date: string; startsAt: Date } | null {
  if (!person.active || person.role === "hr") return null;
  const tz = person.timezone;
  for (const date of [localDate(now, tz), localDate(new Date(now.getTime() + DAY), tz)]) {
    if (!person.workHours.days.includes(weekdayOf(date))) continue;
    const startsAt = zonedTime(date, person.workHours.start, tz);
    const from = startsAt.getTime() - MORNING_RULES.leadMinutes * MINUTE;
    const to = startsAt.getTime() + MORNING_RULES.lateHours * HOUR;
    if (now.getTime() < from || now.getTime() >= to) continue;
    if (isAway(person, absences, new Date(startsAt.getTime() + MINUTE)).reason === "absence") return null;
    return { date, startsAt };
  }
  return null;
}

// ---------- Plano da manhã

export interface PlanQuestion {
  id: string;
  askerId: string;
  createdAt: Date;
  /** Branch, tarefa ou PR citado, quando a pergunta tem um. */
  subject?: string;
}

export interface PlanFinding {
  reviewId: string;
  pr: Pick<PullRequest, "repository" | "number">;
  severity: FindingSeverity;
  count: number;
}

/** Correção pronta (etapa 10), esperando o autor aprovar ou recusar em Meu plano. */
export interface PlanFix {
  fixId: string;
  pr: Pick<PullRequest, "repository" | "number">;
  draftPrNumber: number;
  readyAt: Date;
  /** Resultado dos testes relatado pelo agente; a CI do rascunho é quem confirma. */
  tests: "passou" | "falhou" | "nao_rodou";
}

export type PlanItemKind = "fix_ready" | "question" | "review_request" | "task_due" | "task_overdue" | "finding" | "ci_failed" | "own_pr_waiting";

export interface PlanItem {
  /** Estável entre dias: a mesma pendência mantém o id (reordenar e descartar no painel). */
  id: string;
  kind: PlanItemKind;
  text: string;
  /** Motivo, escrito por regra. */
  reason: string;
  ref: string;
}

export interface MorningPlanInput {
  person: Person;
  people: Person[];
  now: Date;
  questions: PlanQuestion[];
  pullRequests: PullRequest[];
  tasks: Task[];
  findings: PlanFinding[];
  fixes?: PlanFix[];
  /** Itens que a pessoa descartou antes e que continuam fora enquanto a pendência for a mesma. */
  dismissed?: readonly string[];
}

const firstNameOf = (people: Person[], id: string | undefined) => {
  const p = people.find((x) => x.id === id);
  return p ? (p.name.trim().split(/\s+/)[0] ?? p.name) : "Alguém";
};
const daysSince = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / DAY);
const waitedText = (from: Date, now: Date) => {
  const d = daysSince(from, now);
  if (d >= 2) return `há ${d} dias`;
  if (d === 1) return "há 1 dia";
  return "desde ontem ou hoje";
};
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/**
 * Até 7 itens, ordenados: quem está parado esperando a pessoa (mais antigo primeiro), depois prazo
 * (vencido, depois o mais próximo), depois gravidade. Cada item traz o motivo. Sem modelo.
 */
export function morningPlan(input: MorningPlanInput): { items: PlanItem[]; more: number; all: PlanItem[] } {
  const { person, people, now } = input;
  const today = localDate(now, person.timezone);
  const ranked: { group: number; key: number; item: PlanItem }[] = [];

  // 1. Quem espera pela pessoa: correção pronta para aprovar, perguntas e revisões pedidas.
  for (const f of input.fixes ?? []) {
    const tests = f.tests === "passou" ? "testes relatados pelo agente passaram" : f.tests === "falhou" ? "o agente relatou falha nos testes" : "o agente não rodou os testes";
    ranked.push({
      group: 0,
      key: f.readyAt.getTime() - 1e15,
      item: { id: `fix:${f.fixId}`, kind: "fix_ready", text: `Correção pronta no seu PR ${f.pr.number}, aguardando sua aprovação`, reason: `${tests}; a CI do rascunho ${f.draftPrNumber} confirma`, ref: `fix:${f.fixId}` },
    });
  }
  for (const q of input.questions) {
    const who = firstNameOf(people, q.askerId);
    ranked.push({
      group: 0,
      key: q.createdAt.getTime(),
      item: { id: `question:${q.id}`, kind: "question", text: `${who} deixou uma pergunta${q.subject ? ` sobre ${q.subject}` : ""} e está esperando`, reason: `pergunta que precisa de você, ${waitedText(q.createdAt, now)}`, ref: `question:${q.id}` },
    });
  }
  for (const pr of input.pullRequests) {
    if (pr.state !== "open" || pr.authorId === person.id || !pr.reviewerIds.includes(person.id)) continue;
    const since = pr.openedAt ?? now;
    ranked.push({
      group: 0,
      key: since.getTime(),
      item: { id: `review:${pr.repository}#${pr.number}`, kind: "review_request", text: `PR ${pr.number} de ${firstNameOf(people, pr.authorId)} espera sua revisão`, reason: `revisão pedida a você, ${waitedText(since, now)}`, ref: `github:pr/${pr.number}` },
    });
  }

  // 2. Prazos.
  for (const t of input.tasks) {
    if (t.assigneeId !== person.id || !t.dueDate || t.state === "done" || t.state === "canceled") continue;
    if (t.dueDate < today) {
      ranked.push({ group: 1, key: Date.parse(`${t.dueDate}T00:00:00Z`) - 1e15, item: { id: `due:${t.key}`, kind: "task_overdue", text: `${t.key} passou do prazo`, reason: `prazo era ${t.dueDate.slice(8, 10)}/${t.dueDate.slice(5, 7)}`, ref: `linear:${t.key}` } });
    } else if (t.dueDate <= addDays(today, MORNING_RULES.dueSoonDays)) {
      const when = t.dueDate === today ? "hoje" : t.dueDate === addDays(today, 1) ? "amanhã" : WEEKDAY[weekdayOf(t.dueDate)]!;
      ranked.push({ group: 1, key: Date.parse(`${t.dueDate}T00:00:00Z`), item: { id: `due:${t.key}`, kind: "task_due", text: `Prazo da ${t.key} é ${when}`, reason: `prazo em até ${MORNING_RULES.dueSoonDays} dias`, ref: `linear:${t.key}` } });
    }
  }

  // 3. Gravidade: CI vermelha e achados da análise noturna nos PRs da pessoa; por último, o PR dela parado.
  for (const pr of input.pullRequests) {
    if (pr.authorId !== person.id || pr.state !== "open") continue;
    if (pr.checksState === "failure") {
      ranked.push({ group: 2, key: 0, item: { id: `ci:${pr.repository}#${pr.number}`, kind: "ci_failed", text: `CI vermelha no seu PR ${pr.number}`, reason: "checagens falharam na última versão", ref: `github:pr/${pr.number}` } });
    }
  }
  for (const f of input.findings) {
    const label = f.severity === "alta" ? "alta" : f.severity === "media" ? "média" : "baixa";
    ranked.push({
      group: 2,
      key: 1 + severityRank(f.severity),
      item: { id: `finding:${f.reviewId}`, kind: "finding", text: `Análise automática do seu PR ${f.pr.number}: ${f.count} ${f.count === 1 ? "achado" : "achados"}`, reason: `gravidade mais alta: ${label}`, ref: `github:pr/${f.pr.number}` },
    });
  }
  for (const pr of input.pullRequests) {
    if (pr.authorId !== person.id || pr.state !== "open" || !pr.openedAt || pr.reviewerIds.length > 0) continue;
    if (daysSince(pr.openedAt, now) < 1) continue;
    ranked.push({ group: 3, key: pr.openedAt.getTime(), item: { id: `own:${pr.repository}#${pr.number}`, kind: "own_pr_waiting", text: `Seu PR ${pr.number} está sem revisor`, reason: `aberto ${waitedText(pr.openedAt, now)}`, ref: `github:pr/${pr.number}` } });
  }

  const dismissed = new Set(input.dismissed ?? []);
  const seen = new Set<string>();
  const ordered = ranked
    .sort((a, b) => a.group - b.group || a.key - b.key || (a.item.id < b.item.id ? -1 : 1))
    .map((r) => r.item)
    .filter((i) => !dismissed.has(i.id) && !seen.has(i.id) && seen.add(i.id));
  return { items: ordered.slice(0, MORNING_RULES.maxItems), more: Math.max(ordered.length - MORNING_RULES.maxItems, 0), all: ordered };
}

/** Reordenar e descartar em Meu plano: ids desconhecidos são ignorados; os não citados mantêm a ordem no fim. */
export function applyPlanEdits(items: PlanItem[], edits: { order?: readonly string[]; dismiss?: readonly string[] }): PlanItem[] {
  const dismissed = new Set(edits.dismiss ?? []);
  const kept = items.filter((i) => !dismissed.has(i.id));
  if (!edits.order) return kept;
  const pos = new Map(edits.order.map((id, i) => [id, i]));
  return [...kept].sort((a, b) => (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER) || kept.indexOf(a) - kept.indexOf(b));
}
