import type { TaskState } from "@echo/domain";
import type { NormalizedEvent } from "./normalized.ts";

/** Tipo de estado do Linear → estado do Echo. "In Review" vem como started com nome próprio. */
export function linearState(type: string, name = ""): TaskState {
  switch (type) {
    case "completed": return "done";
    case "canceled": return "canceled";
    case "started": return /review|revis/i.test(name) ? "in_review" : "in_progress";
    case "unstarted": return "todo";
    default: return "backlog"; // backlog, triage
  }
}

/** Organização do Linear que enviou o aviso: aponta para a empresa em installation_routes. */
export const linearRouteKey = (body: any): string | undefined => (typeof body?.organizationId === "string" ? body.organizationId : undefined);

/** Normaliza um webhook do Linear (Issue create/update/remove). */
export function normalizeLinear(body: any): NormalizedEvent[] {
  if (body?.type !== "Issue") return [{ kind: "ignored", reason: `linear ${body?.type ?? "?"} não usado` }];
  const d = body.data;
  if (body.action === "remove") {
    return [{
      kind: "task_upsert",
      task: { key: d.identifier, linearId: d.id, title: d.title, state: "canceled", labels: [], updatedAt: new Date(d.updatedAt ?? body.createdAt) },
    }];
  }
  const state = linearState(d.state?.type ?? "backlog", d.state?.name);
  const updatedAt = new Date(d.updatedAt ?? body.createdAt);
  const out: NormalizedEvent[] = [{
    kind: "task_upsert",
    task: {
      key: d.identifier,
      linearId: d.id,
      title: d.title,
      assignee: d.assigneeId ? { platform: "linear", externalId: d.assigneeId } : undefined,
      state,
      dueDate: d.dueDate ?? undefined,
      size: typeof d.estimate === "number" ? d.estimate : undefined,
      labels: (d.labels ?? []).map((l: { name: string }) => l.name),
      updatedAt,
    },
  }];
  // Conclusão vira fato do trabalho (uma vez: chave pelo id da tarefa e data de conclusão).
  const becameDone = state === "done" && (body.action === "create" || body.updatedFrom?.stateId !== undefined);
  if (becameDone) {
    out.push({
      kind: "work_event",
      event: {
        type: "task_done",
        actor: d.assigneeId ? { platform: "linear", externalId: d.assigneeId } : undefined,
        taskKey: d.identifier,
        occurredAt: new Date(d.completedAt ?? updatedAt),
        source: "linear",
        sourceRef: `task_done:${d.id}:${d.completedAt ?? updatedAt.toISOString()}`,
      },
    });
  }
  return out;
}
