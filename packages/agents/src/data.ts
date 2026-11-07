// Porta de leitura dos agentes: tudo o que as ferramentas consultam, já preso a uma empresa.
// Nenhum método escreve. A implementação em Postgres fica em `pg-data.ts` (só no servidor).
import type { Absence, Contribution, DailyNote, Person, PullRequest, Task, WorkEvent } from "@echo/domain";

export interface OrgSettings {
  monthlyLimitUsd: number;
  hardLimitUsd: number;
  /** Repositórios que toda a equipe pode ver. Os outros, só autor e revisores do PR. */
  repositoriesOpenToTeam: string[];
  /** Limite de carga por equipe (pontos). */
  teamLoadLimits: Record<string, number>;
}

export interface AgentData {
  orgSettings(): Promise<OrgSettings>;
  /** Gasto com modelos desde `since`, somado de `agent_runs`. */
  spentUsdSince(since: Date): Promise<number>;
  people(): Promise<Person[]>;
  absences(): Promise<Absence[]>;
  latestDailyNote(personId: string): Promise<DailyNote | null>;
  task(key: string): Promise<Task | null>;
  tasks(filter: { assigneeId?: string; openOnly?: boolean }): Promise<Task[]>;
  pullRequests(filter: { number?: number; repository?: string; branch?: string; authorId?: string; openOnly?: boolean; taskKey?: string }): Promise<PullRequest[]>;
  /** Último commit visto na branch, pelos fatos do trabalho. */
  lastCommitAt(repository: string, branch: string): Promise<Date | null>;
  events(filter: { personId?: string; since: Date; limit?: number }): Promise<WorkEvent[]>;
  contributions(since: Date): Promise<Contribution[]>;
  /** Ajustes da própria pessoa no quem sabe (incluir ou excluir um tema, com validade). */
  expertiseOverrides(): Promise<ExpertiseOverride[]>;
}

export interface ExpertiseOverride {
  personId: string;
  topic: string;
  include: boolean;
  validUntil?: Date;
}
