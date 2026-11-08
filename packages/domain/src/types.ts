// Tipos de domínio compartilhados por todas as frentes (independentes do banco).
import type { AvatarTraits } from "./avatar.ts";

export type PersonRole = "member" | "leader" | "hr";

export interface WorkHours {
  /** 0 = domingo … 6 = sábado, no fuso da pessoa. */
  days: number[];
  /** "09:00" */
  start: string;
  /** "18:00" */
  end: string;
}

export interface Person {
  id: string;
  orgId: string;
  name: string;
  role: PersonRole;
  teamId?: string | undefined;
  timezone: string; // IANA
  workHours: WorkHours;
  skills: string[];
  areas: string[];
  active: boolean;
  /** Como a pessoa quer que o agente dela responda (texto dela, já limpo por cleanAgentText). */
  agentStyle?: string | undefined;
  /** Cargo e idiomas declarados no cadastro (perfil fechado, sem dados pessoais). */
  jobTitle?: string | undefined;
  languages?: string[] | undefined;
  /** Traços do bonequinho (avatar.ts), quando vieram da foto no cadastro. */
  avatar?: AvatarTraits | undefined;
}

export type AbsenceKind = "vacation" | "leave" | "unexpected" | "ooo";
export interface Absence {
  personId: string;
  startsAt: Date;
  endsAt: Date;
  kind: AbsenceKind;
  inferred?: boolean;
}

export type TaskState = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
export interface Task {
  id: string;
  key: string; // ECH-128
  title: string;
  assigneeId?: string | undefined;
  state: TaskState;
  dueDate?: string | undefined; // AAAA-MM-DD
  size?: number | undefined; // sem tamanho vale 2 pontos
  area?: string | undefined;
  labels: string[];
  hasLinearId: boolean;
  /** Chaves das tarefas que precisam terminar antes desta (relações do tracker). */
  blockedBy?: readonly string[] | undefined;
}

export type PrState = "open" | "draft" | "merged" | "closed";
export interface PullRequest {
  id: string;
  repository: string;
  number: number;
  title: string;
  authorId?: string | undefined;
  state: PrState;
  branch: string;
  files: string[];
  taskKey?: string | undefined;
  reviewerIds: string[];
  openedAt?: Date | undefined;
  mergedAt?: Date | undefined;
  /** Estado das checagens (CI) na última versão. */
  checksState?: "success" | "failure" | "pending" | undefined;
  headSha?: string | undefined;
}

export interface BranchMark {
  branch: string;
  to?: string;
  reason?: string;
  until?: string;
  /** Liberação trazida de uma nota anterior já confirmada: a validade conta desta data (ISO), não da nota nova. */
  confirmedAt?: string;
}

export type DailyNoteState = "draft" | "confirmed" | "auto_unreviewed";
export interface DailyNote {
  personId: string;
  date: string; // AAAA-MM-DD no fuso da pessoa
  stoppedAt?: string | undefined;
  blocked?: string | undefined;
  released: BranchMark[];
  reserved: BranchMark[];
  state: DailyNoteState;
  confirmedAt?: Date | undefined;
}

export type WorkEventType = "commit" | "pr_opened" | "pr_merged" | "pr_closed" | "review" | "review_comment" | "task_created" | "task_updated" | "task_done" | "comment";
export interface WorkEvent {
  type: WorkEventType;
  personId?: string | undefined;
  repository?: string | undefined;
  branch?: string | undefined;
  prNumber?: number | undefined;
  taskKey?: string | undefined;
  occurredAt: Date;
  source: "github" | "linear" | "slack" | "panel";
  sourceRef: string;
  /** Quando o Echo gravou o evento (registro atrasado entra no relatório seguinte). */
  recordedAt?: Date | undefined;
  data?: Record<string, unknown>;
}

export type ContributionKind = "coauthor" | "review_change" | "panel_confirm" | "reaction" | "unblock";
export interface Contribution {
  helperId: string;
  helpedId: string;
  kind: ContributionKind;
  confirmed: boolean;
  occurredAt: Date;
  deliveryRef?: string;
}

/** Fonte citada numa resposta. Sem fonte, sem afirmação. */
export interface SourceRef {
  label: string; // "nota do dia de Fernando (confirmada)"
  ref: string; // "daily_note:<id>" | "github:pr/42" | "linear:ECH-128"
}
