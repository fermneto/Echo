// Jira Cloud (etapa 21): tarefa do Jira vira a mesma tarefa do Echo que vem do Linear. O workflow de cada
// projeto tem nomes próprios; a categoria do estado (new / indeterminate / done) é fixa e decide, e o nome só
// separa revisão e cancelamento. Story points viram tamanho; etiquetas e componentes viram área.
import type { TaskState } from "@echo/domain";
import type { ExternalTask, NormalizedEvent } from "./normalized.ts";

/** Campo dos story points: muda por site (o padrão do Jira Cloud é o "Story point estimate"). */
export const DEFAULT_STORY_POINTS_FIELD = "customfield_10016";
export const JIRA_FIELDS = ["summary", "status", "assignee", "duedate", "labels", "components", "updated", "resolutiondate"] as const;

/** Categoria do estado no Jira → estado do Echo. */
export function jiraState(categoryKey: string | undefined, name = ""): TaskState {
  switch (categoryKey) {
    case "done":
      return /cancel|won.?t|descart|duplicad|duplicate|rejeit|reject/i.test(name) ? "canceled" : "done";
    case "indeterminate":
      return /review|revis/i.test(name) ? "in_review" : "in_progress";
    case "new":
      return /backlog/i.test(name) ? "backlog" : "todo";
    default:
      return "backlog";
  }
}

/** Site do Jira que enviou o aviso (ex.: acme.atlassian.net): aponta para a empresa em installation_routes. */
export function jiraRouteKey(body: any): string | undefined {
  const self = body?.issue?.self;
  if (typeof self !== "string") return undefined;
  try {
    return new URL(self).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Issue da API (busca, consulta ou webhook) → tarefa do Echo. `linearId` guarda o id da tarefa no tracker. */
export function jiraTask(issue: any, storyPointsField = DEFAULT_STORY_POINTS_FIELD): ExternalTask {
  const f = issue?.fields ?? {};
  const points = f[storyPointsField];
  const labels = [...((f.labels as string[] | undefined) ?? []), ...((f.components as { name?: string }[] | undefined) ?? []).flatMap((c) => (c?.name ? [c.name] : []))];
  return {
    key: issue.key,
    linearId: String(issue.id),
    title: f.summary ?? issue.key,
    assignee: f.assignee?.accountId ? { platform: "jira", externalId: f.assignee.accountId } : undefined,
    state: jiraState(f.status?.statusCategory?.key, f.status?.name),
    dueDate: f.duedate ?? undefined,
    size: typeof points === "number" ? points : undefined,
    labels: [...new Set(labels)],
    updatedAt: new Date(f.updated ?? Date.now()),
    completedAt: f.resolutiondate ? new Date(f.resolutiondate) : undefined,
  };
}

/** Normaliza um webhook do Jira (jira:issue_created / updated / deleted). */
export function normalizeJira(body: any, storyPointsField = DEFAULT_STORY_POINTS_FIELD): NormalizedEvent[] {
  const event: string | undefined = body?.webhookEvent;
  if (!event?.startsWith("jira:issue_") || !body.issue?.key) return [{ kind: "ignored", reason: `jira ${event ?? "?"} não usado` }];
  const task = jiraTask(body.issue, storyPointsField);
  const at = typeof body.timestamp === "number" ? new Date(body.timestamp) : task.updatedAt;
  if (event === "jira:issue_deleted") return [{ kind: "task_upsert", task: { ...task, state: "canceled", updatedAt: at } }];

  const out: NormalizedEvent[] = [{ kind: "task_upsert", task }];
  // Conclusão vira fato do trabalho, uma vez: mesma chave da reconciliação.
  const statusChanged = ((body.changelog?.items as { field?: string; fieldId?: string }[] | undefined) ?? []).some((i) => i.fieldId === "status" || i.field === "status");
  if (task.state === "done" && (event === "jira:issue_created" || statusChanged)) {
    out.push({
      kind: "work_event",
      event: {
        type: "task_done",
        actor: task.assignee,
        taskKey: task.key,
        occurredAt: task.completedAt ?? at,
        source: "jira",
        sourceRef: `task_done:${task.linearId}`,
      },
    });
  }
  return out;
}
