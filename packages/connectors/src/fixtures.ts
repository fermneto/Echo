// Webhooks simulados (só dados sintéticos), no formato que as plataformas enviam.
export const T0 = "2026-11-07T06:12:00Z";

export const ghPush = (over: Record<string, unknown> = {}) => ({
  ref: "refs/heads/ech-128-tempo-limite",
  installation: { id: 555 },
  repository: { full_name: "org-teste/app" },
  commits: [
    { id: "a1b2c3", message: "Trata o tempo limite\n\nCo-authored-by: Carla <carla-dev@users.noreply.github.com>", timestamp: T0, author: { username: "Fernando-Dev", name: "Fernando" } },
    { id: "d4e5f6", message: "wip", timestamp: T0, author: { name: "Alguém sem conta" } },
  ],
  ...over,
});

export const ghPr = (action: string, pr: Record<string, unknown> = {}) => ({
  action,
  installation: { id: 555 },
  repository: { full_name: "org-teste/app" },
  pull_request: {
    number: 42,
    title: "ECH-128: tempo limite nos pagamentos",
    state: "open",
    draft: false,
    merged: false,
    merged_at: null,
    created_at: "2026-11-06T20:00:00Z",
    updated_at: "2026-11-06T21:00:00Z",
    head: { ref: "ech-128-tempo-limite", sha: "a1b2c3" },
    user: { login: "fernando-dev", id: 101 },
    requested_reviewers: [{ login: "carla-dev", id: 102 }],
    ...pr,
  },
});

export const ghReview = (id = 9001, submittedAt = "2026-11-06T22:00:00Z") => ({
  action: "submitted",
  installation: { id: 555 },
  repository: { full_name: "org-teste/app" },
  pull_request: ghPr("x").pull_request,
  review: { id, user: { login: "carla-dev", id: 102 }, state: "COMMENTED", submitted_at: submittedAt },
});

export const linearIssue = (over: Record<string, unknown> = {}, action = "update") => ({
  action,
  type: "Issue",
  organizationId: "lin-org-1",
  createdAt: T0,
  webhookTimestamp: Date.parse(T0),
  data: {
    id: "lin-uuid-128",
    identifier: "ECH-128",
    title: "Tempo limite nos pagamentos",
    assigneeId: "lin-user-fer",
    state: { type: "started", name: "In Progress" },
    dueDate: "2026-11-13",
    estimate: 3,
    labels: [{ name: "pagamentos" }],
    updatedAt: T0,
    ...over,
  },
});

export const slackEnvelope = (event: Record<string, unknown>, eventId = "Ev01") => ({
  type: "event_callback",
  team_id: "T-DEMO",
  event_id: eventId,
  event,
});
