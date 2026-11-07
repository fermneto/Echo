// Assinaturas das regras fixas (aba Regras e Calculadoras). Frente: Funções implementa e testa.
// Mesma entrada, mesma saída. Recebem `now` explícito (do Clock), nunca leem a hora do sistema.
import type { Absence, BranchMark, Contribution, DailyNote, Person, PullRequest, SourceRef, Task, WorkEvent } from "./types.ts";

const todo = (name: string): never => {
  throw new Error(`${name}: não implementado (frente Funções)`);
};

// ---------- Disponibilidade
export interface AwayResult {
  away: boolean;
  reason?: "off_hours" | "absence" | "weekend";
  /** Próximo início de expediente fora de ausência. */
  returnsAt?: Date;
}
export function isAway(_person: Person, _absences: Absence[], _now: Date): AwayResult {
  return todo("isAway");
}

// ---------- Status de branch
export type BranchStatus = "released" | "reserved" | "in_progress" | "no_activity" | "unknown";
export interface BranchStatusResult {
  status: BranchStatus;
  mark?: BranchMark;
  sources: SourceRef[];
}
export interface BranchStatusInput {
  branch: string;
  note?: DailyNote;
  pr?: PullRequest;
  task?: Task;
  lastCommitAt?: Date;
  now: Date;
}
/** Liberação vale 7 dias (ou durante a ausência). auto_unreviewed mantém reservas e não libera. */
export function branchStatus(_input: BranchStatusInput): BranchStatusResult {
  return todo("branchStatus");
}

// ---------- Carga
export interface CapacityCard {
  personId: string;
  load: number;
  limit: number;
  slack: number; // limit - load
  areas: string[];
  overLimit: boolean;
}
export interface CapacityInput {
  person: Person;
  openTasks: Task[];
  pendingReviews: number;
  absences: Absence[];
  adjustment: number;
  teamLimit: number;
  now: Date;
}
/**
 * carga = tamanhos abertos (sem tamanho = 2) + revisões × 0,5 + 1 por prazo em até 3 dias + ajustes
 * limite = limite da equipe × parte dos próximos 7 dias sem ausência
 */
export function capacityCard(_input: CapacityInput): CapacityCard {
  return todo("capacityCard");
}

// ---------- Redistribuição
export interface PlanAssignment {
  taskId?: string;
  prId?: string;
  fromId: string;
  toId?: string; // ausente = não coube
  reason: string; // escrito por regra
}
export interface PlanOptionsResult {
  assignments: PlanAssignment[];
  unassigned: PlanAssignment[];
}
export interface PlanInput {
  absentId: string;
  tasks: Task[];
  reviews: PullRequest[];
  candidates: { person: Person; card: CapacityCard; absences: Absence[]; hasLinearAccount: boolean }[];
  now: Date;
}
export function planOptions(_input: PlanInput): PlanOptionsResult {
  return todo("planOptions");
}
export function planReviewers(_input: PlanInput): PlanAssignment[] {
  return todo("planReviewers");
}

// ---------- Relatório semanal
export interface WeeklyMetrics {
  deliveries: number;
  commits: number;
  reviews: number;
  helps: number;
  delays: { taskKey: string; cause?: string }[];
}
export function weeklyMetrics(_input: { personId: string; events: WorkEvent[]; contributions: Contribution[]; tasks: Task[]; from: Date; to: Date }): WeeklyMetrics {
  return todo("weeklyMetrics");
}
export function contributionScore(_c: Contribution): { weight: "forte" | "medio" } {
  return todo("contributionScore");
}

// ---------- Quem sabe
export interface TopicEvidence {
  personId: string;
  kind: "pr_merged" | "help" | "review" | "task_done" | "profile";
  at: Date;
  source: SourceRef;
}
export interface TopicCandidate {
  personId: string;
  score: number;
  status: "available" | "over_limit" | "vacation";
  evidence: SourceRef[];
}
/** pontuação = Σ pesos (PR 3, ajuda 3, revisão 2, tarefa 1, perfil 1) × recência (1 ≤ 90d, 0,5 ≤ 1 ano, 0 depois). Até 3 pessoas. */
export function peopleForTopic(_input: { evidence: TopicEvidence[]; people: Person[]; status: Record<string, TopicCandidate["status"]>; excluded: string[]; now: Date }): TopicCandidate[] {
  return todo("peopleForTopic");
}

// ---------- Custo
export type CostLevel = "normal" | "stop_fixes" | "rules_only" | "hard_limit";
/** 80%: param correção e vídeos · 100%: só regras (ausentes seguem) · 200%: ausentes sem IA. */
export function costLevel(_spentUsd: number, _monthlyLimitUsd: number): CostLevel {
  return todo("costLevel");
}
