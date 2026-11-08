// Dependências vindas do tracker: entram em blockedBy só as relações de bloqueio que seguram a própria tarefa.
import { describe, expect, it } from "vitest";
import { jiraTask } from "./jira.ts";
import { toTask } from "./linear-client.ts";
import { normalizeLinear } from "./linear.ts";

const linear = (nodes: unknown[]) => ({ id: "i", identifier: "ECH-1", title: "t", updatedAt: "2026-11-09T00:00:00Z", state: { type: "unstarted" }, labels: { nodes: [] }, inverseRelations: { nodes } });
const jira = (issuelinks?: unknown[]) => ({ id: "1", key: "ECH-1", fields: { summary: "t", status: { statusCategory: { key: "new" } }, updated: "2026-11-09T00:00:00Z", ...(issuelinks ? { issuelinks } : {}) } });

describe("dependências do tracker", () => {
  it("Linear: só a relação blocks que aponta para a tarefa", () => {
    expect(toTask(linear([{ type: "blocks", issue: { identifier: "ECH-2" } }, { type: "related", issue: { identifier: "ECH-3" } }])).blockedBy).toEqual(["ECH-2"]);
    expect(toTask(linear([])).blockedBy).toEqual([]);
  });

  it("Linear: aviso sem relações não apaga o que já estava", () => {
    const [ev] = normalizeLinear({ type: "Issue", action: "update", createdAt: "2026-11-09T00:00:00Z", data: { id: "i", identifier: "ECH-1", title: "t", state: { type: "unstarted" } } });
    expect(ev).toMatchObject({ kind: "task_upsert" });
    expect((ev as { task: { blockedBy?: string[] } }).task.blockedBy).toBeUndefined();
  });

  it("Jira: só o vínculo Blocks com inwardIssue segura a tarefa", () => {
    const links = [
      { type: { name: "Blocks" }, inwardIssue: { key: "ECH-2" } },
      { type: { name: "Blocks" }, outwardIssue: { key: "ECH-3" } },
      { type: { name: "Relates" }, inwardIssue: { key: "ECH-4" } },
    ];
    expect(jiraTask(jira(links)).blockedBy).toEqual(["ECH-2"]);
    expect(jiraTask(jira()).blockedBy).toBeUndefined();
  });
});
