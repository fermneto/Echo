// Formato padronizado de tudo que chega das plataformas (F1). Pessoas aparecem como identificadores
// EXTERNOS; quem é quem no Echo é resolvido no ingest pela tabela identities, sem adivinhar.
import type { PrState, TaskState, WorkEventType } from "@echo/domain";

export type Platform = "github" | "slack" | "linear";

export interface ExternalActor {
  platform: Platform;
  /** id estável na plataforma (Slack U…, Linear uuid, GitHub id numérico). */
  externalId?: string | undefined;
  /** login do GitHub (comparado sem diferenciar maiúsculas). */
  login?: string | undefined;
}

export interface ExternalWorkEvent {
  type: WorkEventType;
  actor?: ExternalActor | undefined;
  repository?: string | undefined;
  branch?: string | undefined;
  prNumber?: number | undefined;
  taskKey?: string | undefined;
  occurredAt: Date;
  source: Platform;
  /** Chave única do fato na origem (sha do commit, id da revisão…). */
  sourceRef: string;
  data?: Record<string, unknown>;
}

export interface ExternalTask {
  key: string;
  linearId: string;
  title: string;
  assignee?: ExternalActor | undefined;
  state: TaskState;
  dueDate?: string | undefined;
  size?: number | undefined;
  labels: string[];
  updatedAt: Date;
  completedAt?: Date | undefined;
}

export interface ExternalPullRequest {
  repository: string;
  number: number;
  title: string;
  author?: ExternalActor | undefined;
  state: PrState;
  branch: string;
  headSha?: string | undefined;
  taskKey?: string | undefined;
  reviewers: ExternalActor[];
  openedAt?: Date | undefined;
  mergedAt?: Date | undefined;
  updatedAt: Date;
}

/** PR consultado ao vivo: inclui arquivos e se dá para unir (null = o GitHub ainda está calculando). */
export interface LivePullRequest extends ExternalPullRequest {
  files: string[];
  mergeable: boolean | null;
}

export interface ChatMessage {
  channel: string;
  ts: string;
  threadTs?: string | undefined;
  userExternalId: string;
  text: string;
  mentions: string[];
  mentionsBot: boolean;
  isDm: boolean;
  /** Autor da mensagem-mãe do tópico (para saber se é um tópico do Echo). */
  parentUserId?: string | undefined;
  /** A mensagem continua um tópico aberto pelo Echo (responde sem nova marcação). */
  inEchoThread?: boolean | undefined;
}

export type NormalizedEvent =
  | { kind: "work_event"; event: ExternalWorkEvent }
  | { kind: "task_upsert"; task: ExternalTask }
  | { kind: "pr_upsert"; pr: ExternalPullRequest }
  | { kind: "chat_message"; message: ChatMessage }
  | { kind: "reaction"; channel: string; ts: string; reaction: string; reactorExternalId: string; authorExternalId: string; at: Date }
  | { kind: "checks"; repository: string; headSha: string; prNumbers: number[]; state: ChecksState; url: string; at: Date }
  | { kind: "deployment"; deployment: ExternalDeployment }
  | { kind: "ignored"; reason: string };

/** Estado dos checks de um commit: só o resumo, nunca logs. */
export type ChecksState = "success" | "failure" | "pending" | "neutral";

export interface ExternalDeployment {
  provider: "vercel";
  externalId: string;
  repository?: string | undefined;
  sha?: string | undefined;
  branch?: string | undefined;
  environment: "preview" | "production";
  state: "building" | "ready" | "error" | "canceled";
  url?: string | undefined;
  at: Date;
}

/** Identificador de tarefa no nome da branch ou no título: "ech-128-tempo-limite" → "ECH-128". */
export function taskKeyFrom(...texts: (string | undefined | null)[]): string | undefined {
  for (const t of texts) {
    const m = t?.match(/\b([a-z][a-z0-9]{1,9})-(\d+)\b/i);
    if (m) return `${m[1]!.toUpperCase()}-${m[2]}`;
  }
  return undefined;
}
