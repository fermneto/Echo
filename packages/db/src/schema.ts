// Esquema do Echo (aba Dados do manual). Toda tabela de negócio tem org_id.
// RLS e chaves compostas com org_id entram na migração de isolamento (etapa 2, frente Funções).
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const orgId = () => uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const orgs = pgTable("orgs", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("demo"),
  monthlyLimitUsd: numeric("monthly_limit_usd", { precision: 10, scale: 2 }).notNull().default("50"),
  hardLimitUsd: numeric("hard_limit_usd", { precision: 10, scale: 2 }).notNull().default("100"),
  gainsBaseline: jsonb("gains_baseline"),
  repositoriesOpenToTeam: jsonb("repositories_open_to_team").$type<string[]>().notNull().default([]),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Canal do Slack (C…) de reserva para o vídeo da semana: vale para equipe sem canal e empresa sem equipes. */
  slackChannelId: text("slack_channel_id"),
  createdAt: createdAt(),
});

/** Instalações por empresa: GitHub, Slack, Linear… Tokens cifrados com AES-256-GCM. */
export const installations = pgTable("installations", {
  id: id(),
  orgId: orgId(),
  kind: text("kind").notNull(), // github | slack | linear | rh
  externalId: text("external_id").notNull(),
  tokensEncrypted: text("tokens_encrypted"),
  expiresAt: ts("expires_at"),
  connectedBy: uuid("connected_by"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("installations_kind_ext").on(t.kind, t.externalId)]);

/** Única exceção ao RLS: acha a empresa de um webhook. Só identificadores. */
export const installationRoutes = pgTable("installation_routes", {
  kind: text("kind").notNull(),
  externalId: text("external_id").notNull(),
  orgId: uuid("org_id").notNull(),
}, (t) => [primaryKey({ columns: [t.kind, t.externalId] })]);

export const teams = pgTable("teams", {
  id: id(),
  orgId: orgId(),
  name: text("name").notNull(),
  leaderId: uuid("leader_id"),
  loadLimit: integer("load_limit").notNull().default(12),
  /** Canal do Slack (C…) da equipe, onde sai o vídeo da semana para a equipe assistir e comentar junto. */
  slackChannelId: text("slack_channel_id"),
});

/** Pessoas. Sem tempo online. */
export const people = pgTable("people", {
  id: id(),
  orgId: orgId(),
  teamId: uuid("team_id").references(() => teams.id),
  name: text("name").notNull(),
  role: text("role").notNull().default("member"), // member | leader | hr
  timezone: text("timezone").notNull(), // IANA, ex.: America/Fortaleza
  workHours: jsonb("work_hours").$type<{ days: number[]; start: string; end: string }>().notNull(),
  jobTitle: text("job_title"),
  skills: jsonb("skills").$type<string[]>().notNull().default([]),
  areas: jsonb("areas").$type<string[]>().notNull().default([]),
  languages: jsonb("languages").$type<string[]>().notNull().default([]),
  awayInstructions: text("away_instructions"),
  /** Como a pessoa quer que o agente dela responda e como ela costuma atuar. Escrito só por ela; muda o tom, nunca as regras. */
  agentStyle: text("agent_style"),
  /** Até onde o agente pode decidir por ela, em texto livre. Só vale dentro das travas fixas de `@echo/domain` (delegation). */
  delegation: text("delegation"),
  /** Quando a pessoa salvou a delegação atual: a decisão tomada por ela cita essa versão. */
  delegationUpdatedAt: ts("delegation_updated_at"),
  /** Traços do bonequinho (lista fechada de packages/domain, conferida na leitura), lidos da foto no cadastro. A foto não é guardada. */
  avatar: jsonb("avatar").$type<Record<string, string>>(),
  /** Expediente sugerido pela agenda; vale só depois que a pessoa confirma no painel. */
  workHoursSuggested: jsonb("work_hours_suggested").$type<{ days: number[]; start: string; end: string; timezone: string; source: string }>(),
  active: boolean("active").notNull().default(true),
  offboardedAt: ts("offboarded_at"),
  createdAt: createdAt(),
});

/** Liga a pessoa a Slack, GitHub e Linear. */
export const identities = pgTable("identities", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // slack | github | linear
  externalId: text("external_id").notNull(),
  login: text("login"),
}, (t) => [uniqueIndex("identities_platform_ext").on(t.orgId, t.platform, t.externalId)]);

/** Ausências. Sem motivo médico. */
export const absences = pgTable("absences", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  kind: text("kind").notNull(), // vacation | leave | unexpected | ooo
  source: text("source").notNull(), // panel | hr | calendar
  hrEventId: text("hr_event_id"),
  /** Evento de "fora do escritório" da agenda (google:<id> ou microsoft:<id>). Só id e horário, nunca título. */
  calendarEventId: text("calendar_event_id"),
  /** Ausência inferida da agenda. As longas (férias) são sugestão até a liderança confirmar. */
  inferred: boolean("inferred").notNull().default(false),
  confirmedAt: ts("confirmed_at"),
  confirmedBy: uuid("confirmed_by"),
  cancelledAt: ts("cancelled_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("absences_hr_event").on(t.orgId, t.hrEventId), uniqueIndex("absences_calendar_event").on(t.orgId, t.calendarEventId)]);

/** Entrada idempotente de webhooks. */
export const inboxEvents = pgTable("inbox_events", {
  id: id(),
  orgId: uuid("org_id"),
  source: text("source").notNull(),
  deliveryId: text("delivery_id").notNull(),
  payload: jsonb("payload").notNull(),
  state: text("state").notNull().default("received"), // received | processed | failed | ignored
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  receivedAt: createdAt(),
  processedAt: ts("processed_at"),
}, (t) => [uniqueIndex("inbox_source_delivery").on(t.source, t.deliveryId)]);

/** Fatos do trabalho. */
export const workEvents = pgTable("work_events", {
  id: id(),
  orgId: orgId(),
  type: text("type").notNull(), // commit | pr_opened | pr_merged | review | task_done | ...
  personId: uuid("person_id").references(() => people.id),
  repository: text("repository"),
  branch: text("branch"),
  prNumber: integer("pr_number"),
  taskKey: text("task_key"),
  occurredAt: ts("occurred_at").notNull(),
  source: text("source").notNull(),
  sourceRef: text("source_ref").notNull(),
  externalLogin: text("external_login"),
  attributedAt: ts("attributed_at"),
  data: jsonb("data"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("work_events_src").on(t.orgId, t.source, t.sourceRef), index("work_events_person").on(t.orgId, t.personId, t.occurredAt)]);

/**
 * Espelho do tracker de tarefas. A empresa pode usar o Linear e o Jira juntos: `source` diz de qual
 * veio cada tarefa. A chave continua única na empresa, então os dois precisam de prefixos diferentes.
 */
export const tasks = pgTable("tasks", {
  id: id(),
  orgId: orgId(),
  key: text("key").notNull(), // ECH-128
  source: text("source").notNull().default("linear"), // linear | jira
  linearId: text("linear_id"), // id da tarefa no tracker de `source` (UUID no Linear, número no Jira)
  title: text("title").notNull(),
  assigneeId: uuid("assignee_id").references(() => people.id),
  state: text("state").notNull(), // backlog | todo | in_progress | in_review | done | canceled
  dueDate: text("due_date"), // AAAA-MM-DD, vale até o fim do dia no fuso da pessoa
  size: integer("size"),
  area: text("area"),
  labels: jsonb("labels").$type<string[]>().notNull().default([]),
  externalUpdatedAt: ts("external_updated_at"),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("tasks_key").on(t.orgId, t.key)]);

/** Espelho do GitHub. */
export const pullRequests = pgTable("pull_requests", {
  id: id(),
  orgId: orgId(),
  repository: text("repository").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  authorId: uuid("author_id").references(() => people.id),
  state: text("state").notNull(), // open | draft | merged | closed
  branch: text("branch").notNull(),
  headSha: text("head_sha"),
  files: jsonb("files").$type<string[]>().notNull().default([]),
  testsState: text("tests_state"),
  taskKey: text("task_key"),
  reviewerIds: jsonb("reviewer_ids").$type<string[]>().notNull().default([]),
  openedAt: ts("opened_at"),
  mergedAt: ts("merged_at"),
  firstHumanReviewAt: ts("first_human_review_at"),
  checksState: text("checks_state"),
  /** Link dos checks do último commit (só estado, nome e link: nunca logs). */
  checksUrl: text("checks_url"),
  checksUpdatedAt: ts("checks_updated_at"),
  /** Hora da última mudança na origem: avisos fora de ordem não sobrescrevem dado mais novo. */
  externalUpdatedAt: ts("external_updated_at"),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("prs_repo_number").on(t.orgId, t.repository, t.number)]);

/** Cérebro: notas com busca de texto. */
export const brainNotes = pgTable("brain_notes", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").references(() => people.id),
  path: text("path").notNull(), // agente-fernando/diario/2026-11-07.md
  kind: text("kind").notNull(), // perfil | diario | tarefa | alteracao | decisao | nao-mexer | ajuda | correcao | processo | equipe
  content: text("content").notNull(),
  visibility: text("visibility").notNull(), // private | person | team
  version: integer("version").notNull().default(1),
  sha: text("sha"),
  managedByRule: boolean("managed_by_rule").notNull().default(false),
  mirrorConflictAt: ts("mirror_conflict_at"),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("brain_notes_path").on(t.orgId, t.path)]);

export const brainNoteVersions = pgTable("brain_note_versions", {
  id: id(),
  orgId: orgId(),
  noteId: uuid("note_id").notNull().references(() => brainNotes.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  content: text("content").notNull(),
  authorId: uuid("author_id"),
  authorKind: text("author_kind").notNull(), // person | agent | mirror
  createdAt: createdAt(),
});

export interface BranchMarkRow {
  branch: string;
  to?: string;
  reason?: string;
  until?: string;
  /** Liberação trazida de nota anterior confirmada (ISO): a validade conta desta data. */
  confirmedAt?: string;
}

/** Nota do dia: draft → confirmed | auto_unreviewed. */
export const dailyNotes = pgTable("daily_notes", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  date: text("date").notNull(), // AAAA-MM-DD no fuso da pessoa
  stoppedAt: text("stopped_at"),
  blocked: text("blocked"),
  released: jsonb("released").$type<BranchMarkRow[]>().notNull().default([]),
  reserved: jsonb("reserved").$type<BranchMarkRow[]>().notNull().default([]),
  state: text("state").notNull().default("draft"),
  confirmedAt: ts("confirmed_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("daily_notes_person_date").on(t.orgId, t.personId, t.date)]);

/** Perguntas respondidas (ou não) pelo agente. */
export const questions = pgTable("questions", {
  id: id(),
  orgId: orgId(),
  askerId: uuid("asker_id").references(() => people.id),
  ownerId: uuid("owner_id").references(() => people.id),
  kind: text("kind").notNull(), // gemeo | quem_sabe | livre | dm | citacao (proposta citada só pelo nome, F5b)
  channel: text("channel").notNull(), // slack:C123 | painel | mcp
  sourceRef: text("source_ref"),
  text: text("text"),
  textExpiresAt: ts("text_expires_at"),
  answer: text("answer"),
  sources: jsonb("sources").$type<{ label: string; ref: string }[]>().notNull().default([]),
  state: text("state").notNull().default("pending"), // pending | processing | answered | failed | silent
  claimedBy: text("claimed_by"),
  needsOwner: boolean("needs_owner").notNull().default(false),
  digestKind: text("digest_kind"), // reuniao | proposta | decisao | nenhum
  /** Resumo da ausência (F5b): uma linha de pedido e uma de resposta, apagadas na entrega ou em 30 dias. */
  digestRequest: text("digest_request"),
  digestReply: text("digest_reply"),
  /** Quando entrou num resumo entregue ao dono. */
  digestedAt: ts("digested_at"),
  resolved: boolean("resolved"),
  ownerReturnsAt: ts("owner_returns_at"),
  answeredAt: ts("answered_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("questions_source_ref").on(t.orgId, t.sourceRef), index("questions_owner_digest").on(t.orgId, t.ownerId, t.digestedAt)]);

export const reviews = pgTable("reviews", {
  id: id(),
  orgId: orgId(),
  prId: uuid("pr_id").notNull().references(() => pullRequests.id),
  headSha: text("head_sha").notNull(),
  batchId: text("batch_id"),
  model: text("model"),
  findings: jsonb("findings").notNull().default([]),
  /** Arquivos do diff enviado ao lote: achado em arquivo fora desta lista é descartado. */
  files: jsonb("files").$type<string[]>().notNull().default([]),
  state: text("state").notNull().default("queued"), // queued | batched | reviewed | fix_queued | fix_ready | approved | applied | no_findings | too_large | failed
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("reviews_pr_sha").on(t.orgId, t.prId, t.headSha)]);

/** Uma correção por revisão. O diff conferido vai no outbox (github.draft_pr); aqui fica o estado e o custo. */
export const fixRuns = pgTable("fix_runs", {
  id: id(),
  orgId: orgId(),
  reviewId: uuid("review_id").notNull().references(() => reviews.id),
  branch: text("branch"),
  draftPrNumber: integer("draft_pr_number"),
  /** Resultado dos testes que o próprio agente da correção declara no fix.json. */
  testsReported: text("tests_reported"),
  /** Último estado do CI do rascunho lido pela delegação. */
  checksState: text("checks_state"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  state: text("state").notNull().default("queued"), // running | draft_queued | ready | approved | applied | declined | rejected | failed | skipped
  /** Sessão do Managed Agents (para conferir no Console). */
  sessionId: text("session_id"),
  /** Versão do PR sobre a qual a correção foi feita. */
  baseSha: text("base_sha"),
  /** Versão do rascunho criada pela plataforma: só une se continuar igual. */
  draftHeadSha: text("draft_head_sha"),
  files: jsonb("files").$type<string[]>().notNull().default([]),
  findings: jsonb("findings").notNull().default([]),
  error: text("error"),
  decidedBy: uuid("decided_by").references(() => people.id),
  decidedAt: ts("decided_at"),
  /** pessoa (decidiu no painel) | delegacao (o agente decidiu pela delegação escrita da pessoa) */
  decidedVia: text("decided_via"),
  /** Por que a delegação cobriu (ou não) esta correção: travas e juiz, para a pessoa conferir. */
  delegationNote: text("delegation_note"),
  /** Desde quando a delegação espera o CI do rascunho (só une com ele verde); null = não está esperando. */
  ciWaitSince: ts("ci_wait_since"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("fix_runs_review").on(t.orgId, t.reviewId)]);

export const morningPlans = pgTable("morning_plans", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  items: jsonb("items").notNull().default([]),
  state: text("state").notNull().default("sent"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("morning_plans_person_date").on(t.orgId, t.personId, t.date)]);

/** Ajudas. Só a referência da mensagem, nunca o texto. */
export const contributions = pgTable("contributions", {
  id: id(),
  orgId: orgId(),
  helperId: uuid("helper_id").notNull().references(() => people.id),
  helpedId: uuid("helped_id").notNull().references(() => people.id),
  deliveryRef: text("delivery_ref"),
  kind: text("kind").notNull(), // coauthor | review_change | panel_confirm | reaction | unblock
  weight: text("weight").notNull(), // forte | medio
  source: text("source").notNull(),
  sourceRef: text("source_ref").notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  occurredAt: ts("occurred_at").notNull(),
}, (t) => [uniqueIndex("contributions_src").on(t.orgId, t.source, t.sourceRef, t.helperId)]);

export const capacityOverrides = pgTable("capacity_overrides", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  adjustment: integer("adjustment").notNull(),
  reason: text("reason"),
  validUntil: ts("valid_until"),
});

export const expertiseOverrides = pgTable("expertise_overrides", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  include: boolean("include").notNull(),
  validUntil: ts("valid_until"),
});

/** Redistribuição: draft → awaiting_leader → approved → executing → done. */
export const redistributionPlans = pgTable("redistribution_plans", {
  id: id(),
  orgId: orgId(),
  trigger: text("trigger").notNull(), // vacation | unexpected | leader_request | new_demand
  absenceId: uuid("absence_id").references(() => absences.id),
  options: jsonb("options").notNull().default([]),
  choice: jsonb("choice"),
  state: text("state").notNull().default("draft"),
  approvedBy: uuid("approved_by"),
  approvedAt: ts("approved_at"),
  createdAt: createdAt(),
});

export const planItems = pgTable("plan_items", {
  id: id(),
  orgId: orgId(),
  planId: uuid("plan_id").notNull().references(() => redistributionPlans.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id),
  prId: uuid("pr_id").references(() => pullRequests.id),
  fromId: uuid("from_id").references(() => people.id),
  toId: uuid("to_id").references(() => people.id),
  reason: text("reason"),
  context: text("context"),
  state: text("state").notNull().default("proposed"), // proposed | approved | done | refused | unassigned
  refusal: text("refusal"),
});

/** Relatório: draft → awaiting_owner → commented → sent (ou sent_without_notice). */
export const weeklyReports = pgTable("weekly_reports", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  week: text("week").notNull(), // AAAA-Www
  metrics: jsonb("metrics").notNull(),
  text: text("text"),
  observations: jsonb("observations").$type<{ text: string; at: string }[]>().notNull().default([]),
  version: integer("version").notNull().default(1),
  state: text("state").notNull().default("draft"),
  coveredPeriod: jsonb("covered_period").$type<{ from: string; to: string }>().notNull(),
  noticeAt: ts("notice_at"),
  sentAt: ts("sent_at"),
}, (t) => [uniqueIndex("weekly_reports_person_week").on(t.orgId, t.personId, t.week)]);

/** Deploys por commit (Vercel e outros), ligados ao PR pelo commit ou pela branch. Sem logs. */
export const deployments = pgTable("deployments", {
  id: id(),
  orgId: orgId(),
  provider: text("provider").notNull(), // vercel
  externalId: text("external_id").notNull(),
  repository: text("repository"),
  sha: text("sha"),
  branch: text("branch"),
  environment: text("environment").notNull(), // preview | production
  state: text("state").notNull(), // building | ready | error | canceled
  url: text("url"),
  occurredAt: ts("occurred_at").notNull(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("deployments_ext").on(t.orgId, t.provider, t.externalId), index("deployments_sha").on(t.orgId, t.sha)]);

/** Saída segura: só packages/actions executa, só com aprovação. */
export const outboxActions = pgTable("outbox_actions", {
  id: id(),
  orgId: orgId(),
  type: text("type").notNull(), // linear.assign | github.comment | github.set_reviewers | slack.post | github.draft_pr
  target: text("target").notNull(),
  payload: jsonb("payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  approvedBy: uuid("approved_by"),
  state: text("state").notNull().default("pending"), // pending | approved | running | done | failed
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  /** Início da última execução: ação presa em "running" volta para a fila depois de um tempo. */
  startedAt: ts("started_at"),
  /** O que a execução devolveu (ex.: número e versão do PR em rascunho), para o fluxo que pediu a ação. */
  result: jsonb("result"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("outbox_key").on(t.orgId, t.idempotencyKey)]);

export const dailyArtifacts = pgTable("daily_artifacts", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // nota | plano | resumo
  date: text("date").notNull(),
  spec: jsonb("spec").notNull(),
  /** Fatos calculados por regra no momento do resumo (o painel mostra números e nomes a partir deles). */
  facts: jsonb("facts"),
  /** Modelo que montou a especificação (null: layout padrão por regra). */
  model: text("model"),
  version: integer("version").notNull().default(1),
  state: text("state").notNull().default("draft"), // draft | rendered | confirmed | fallback
  updatedAt: ts("updated_at"),
}, (t) => [uniqueIndex("daily_artifacts_person_date_kind").on(t.orgId, t.personId, t.date, t.kind)]);

export const featureVideos = pgTable("feature_videos", {
  id: id(),
  orgId: orgId(),
  reportId: uuid("report_id").notNull().references(() => weeklyReports.id, { onDelete: "cascade" }),
  deliveryRef: text("delivery_ref").notNull(),
  prId: uuid("pr_id").references(() => pullRequests.id),
  script: jsonb("script"),
  storageKey: text("storage_key"),
  durationS: integer("duration_s"),
  state: text("state").notNull().default("queued"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  expiresAt: ts("expires_at"),
});

/**
 * Vídeo da semana da equipe (etapa 27): um por equipe por semana, montado dos relatórios conferidos. Vai direto
 * para a equipe e a liderança no painel; o mp4 fica na Files API (`storage_key`) até `expires_at`.
 */
export const teamVideos = pgTable("team_videos", {
  id: id(),
  orgId: orgId(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  week: text("week").notNull(), // AAAA-Www
  state: text("state").notNull().default("queued"), // queued | recording | ready | failed
  /** Fatos, textos e cenas que foram gravados (sem conteúdo de PR além de título e referência). */
  story: jsonb("story"),
  storageKey: text("storage_key"),
  durationS: integer("duration_s"),
  chapters: jsonb("chapters").$type<{ at: number; title: string }[]>(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  sessionId: text("session_id"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  expiresAt: ts("expires_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("team_videos_team_week").on(t.orgId, t.teamId, t.week)]);

/** Auditoria de toda execução (todo fluxo grava aqui). */
export const agentRuns = pgTable("agent_runs", {
  id: id(),
  orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
  flow: text("flow").notNull(),
  model: text("model"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
  durationMs: integer("duration_ms").notNull(),
  tools: jsonb("tools").$type<string[]>().notNull().default([]),
  result: text("result").notNull(), // ok | fallback | refused | failed | skipped
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [index("agent_runs_org_flow").on(t.orgId, t.flow, t.createdAt)]);

/** Somente adição. */
export const auditLog = pgTable("audit_log", {
  id: id(),
  orgId: orgId(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  createdAt: createdAt(),
});
