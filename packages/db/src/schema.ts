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
  inferred: boolean("inferred").notNull().default(false),
  cancelledAt: ts("cancelled_at"),
  createdAt: createdAt(),
});

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

/** Espelho do Linear. */
export const tasks = pgTable("tasks", {
  id: id(),
  orgId: orgId(),
  key: text("key").notNull(), // ECH-128
  linearId: text("linear_id"),
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
  kind: text("kind").notNull(), // gemeo | quem_sabe | livre | dm
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
  resolved: boolean("resolved"),
  ownerReturnsAt: ts("owner_returns_at"),
  answeredAt: ts("answered_at"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("questions_source_ref").on(t.orgId, t.sourceRef)]);

export const reviews = pgTable("reviews", {
  id: id(),
  orgId: orgId(),
  prId: uuid("pr_id").notNull().references(() => pullRequests.id),
  headSha: text("head_sha").notNull(),
  batchId: text("batch_id"),
  model: text("model"),
  findings: jsonb("findings").notNull().default([]),
  state: text("state").notNull().default("queued"), // queued | batched | reviewed | fix_queued | fix_ready | approved | applied | no_findings | failed
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("reviews_pr_sha").on(t.orgId, t.prId, t.headSha)]);

export const fixRuns = pgTable("fix_runs", {
  id: id(),
  orgId: orgId(),
  reviewId: uuid("review_id").notNull().references(() => reviews.id),
  branch: text("branch"),
  draftPrNumber: integer("draft_pr_number"),
  testsReported: text("tests_reported"),
  checksState: text("checks_state"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  state: text("state").notNull().default("queued"),
  createdAt: createdAt(),
});

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
  createdAt: createdAt(),
}, (t) => [uniqueIndex("outbox_key").on(t.orgId, t.idempotencyKey)]);

export const dailyArtifacts = pgTable("daily_artifacts", {
  id: id(),
  orgId: orgId(),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // nota | plano | resumo
  date: text("date").notNull(),
  spec: jsonb("spec").notNull(),
  version: integer("version").notNull().default(1),
  state: text("state").notNull().default("draft"), // draft | rendered | confirmed | fallback
});

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
  result: text("result").notNull(), // ok | fallback | refused | failed
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
