// Jira Cloud (etapa 21): webhook, estados, assinatura e cliente REST, sem rede (fetch falso).
import { describe, expect, it } from "vitest";
import { adfText, JiraApiError, JiraTracker } from "./jira-client.ts";
import { jiraRouteKey, jiraState, jiraTask, normalizeJira } from "./jira.ts";
import { keyPrefix, sharedKeyPrefixes } from "./task-keys.ts";
import { platformsFromEnv } from "./platforms.ts";
import { sign, verifyJira } from "./signatures.ts";

const issue = (over: Record<string, unknown> = {}, fields: Record<string, unknown> = {}) => ({
  id: "10042",
  key: "ECH-128",
  self: "https://Acme.atlassian.net/rest/api/3/issue/10042",
  fields: {
    summary: "Tratar tempo limite",
    status: { name: "Em andamento", statusCategory: { key: "indeterminate" } },
    assignee: { accountId: "acc-fernando" },
    duedate: "2026-11-13",
    labels: ["backend"],
    components: [{ name: "pagamentos" }],
    customfield_10016: 3,
    updated: "2026-11-07T15:00:00.000-0300",
    resolutiondate: null,
    ...fields,
  },
  ...over,
});

describe("jiraState", () => {
  it("decide pela categoria e usa o nome só para revisão e cancelamento", () => {
    expect(jiraState("new", "To Do")).toBe("todo");
    expect(jiraState("new", "Backlog")).toBe("backlog");
    expect(jiraState("indeterminate", "In Progress")).toBe("in_progress");
    expect(jiraState("indeterminate", "Em revisão")).toBe("in_review");
    expect(jiraState("done", "Done")).toBe("done");
    expect(jiraState("done", "Won't Do")).toBe("canceled");
    expect(jiraState(undefined)).toBe("backlog");
  });
});

describe("normalizeJira", () => {
  it("issue atualizada vira tarefa: story points como tamanho, etiquetas e componentes como área", () => {
    const [ev] = normalizeJira({ webhookEvent: "jira:issue_updated", timestamp: 1_799_000_000_000, issue: issue() });
    expect(ev).toMatchObject({
      kind: "task_upsert",
      task: { key: "ECH-128", linearId: "10042", state: "in_progress", size: 3, dueDate: "2026-11-13", labels: ["backend", "pagamentos"], assignee: { platform: "jira", externalId: "acc-fernando" } },
    });
  });

  it("conclusão vira fato do trabalho uma vez, com a mesma chave da reconciliação", () => {
    const done = issue({}, { status: { name: "Done", statusCategory: { key: "done" } }, resolutiondate: "2026-11-07T18:00:00.000-0300" });
    const changed = normalizeJira({ webhookEvent: "jira:issue_updated", issue: done, changelog: { items: [{ field: "status", fieldId: "status" }] } });
    expect(changed[1]).toMatchObject({ kind: "work_event", event: { type: "task_done", source: "jira", sourceRef: "task_done:10042", taskKey: "ECH-128" } });
    // Outra edição numa tarefa já concluída não repete a conclusão.
    expect(normalizeJira({ webhookEvent: "jira:issue_updated", issue: done, changelog: { items: [{ field: "labels" }] } })).toHaveLength(1);
  });

  it("issue apagada vira cancelada; outro evento é ignorado", () => {
    expect(normalizeJira({ webhookEvent: "jira:issue_deleted", issue: issue() })[0]).toMatchObject({ task: { state: "canceled" } });
    expect(normalizeJira({ webhookEvent: "comment_created", comment: {} })[0]).toMatchObject({ kind: "ignored" });
  });

  it("campo de story points do site é configurável", () => {
    const [ev] = normalizeJira({ webhookEvent: "jira:issue_created", issue: issue({}, { customfield_10028: 5 }) }, "customfield_10028");
    expect(ev).toMatchObject({ task: { size: 5 } });
  });

  it("rota pelo site da issue, em minúsculas", () => {
    expect(jiraRouteKey({ issue: issue() })).toBe("acme.atlassian.net");
    expect(jiraRouteKey({ issue: { self: "não é url" } })).toBeUndefined();
  });
});

describe("verifyJira", () => {
  it("confere o vetor de teste da documentação da Atlassian", () => {
    const h = { "x-hub-signature": "sha256=a4771c39fbe90f317c7824e83ddef3caae9cb3d976c214ace1f2937e133263c9" };
    expect(verifyJira("It's a Secret to Everybody", "Hello World!", h)).toEqual({ ok: true });
  });

  it("recusa assinatura ausente, errada ou de outro algoritmo", () => {
    expect(verifyJira("s", "{}", {}).ok).toBe(false);
    expect(verifyJira("s", "{}", sign.jira("outro", "{}")).ok).toBe(false);
    expect(verifyJira("s", "{}", { "x-hub-signature": "sha1=abc" })).toEqual({ ok: false, reason: "algoritmo não suportado" });
    expect(verifyJira("s", "{}", sign.jira("s", "{}")).ok).toBe(true);
  });
});

type Call = { method: string; url: string; body: any; auth: string | null };
function fakeJira(handler: (c: Call) => Response) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? "GET", url, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init.headers).get("authorization") };
    calls.push(call);
    return handler(call);
  };
  return { calls, tracker: new JiraTracker({ baseUrl: "https://acme.atlassian.net/", email: "echo@acme.com", apiToken: "tok", jql: "project = ECH", fetch }) };
}

describe("JiraTracker", () => {
  it("busca pela /search/jql seguindo o nextPageToken, com o filtro do site", async () => {
    const { calls, tracker } = fakeJira((c) =>
      Response.json(c.body.nextPageToken ? { issues: [issue({ id: "2", key: "ECH-2" })], isLast: true } : { issues: [issue()], nextPageToken: "p2" }),
    );
    const r = await tracker.listOpenTasks();
    expect(r).toMatchObject({ truncated: false });
    expect(r.tasks.map((t) => t.key)).toEqual(["ECH-128", "ECH-2"]);
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://acme.atlassian.net/rest/api/3/search/jql" });
    expect(calls[0]!.body.jql).toBe("(project = ECH) AND statusCategory != Done ORDER BY updated DESC");
    expect(calls[0]!.body.fields).toContain("customfield_10016");
    expect(calls[1]!.body.nextPageToken).toBe("p2");
    expect(calls[0]!.auth).toBe(`Basic ${Buffer.from("echo@acme.com:tok").toString("base64")}`);
  });

  it("para em 10 páginas e avisa que truncou", async () => {
    const { calls, tracker } = fakeJira(() => Response.json({ issues: [issue()], nextPageToken: "mais" }));
    expect((await tracker.listOpenTasks()).truncated).toBe(true);
    expect(calls).toHaveLength(10);
  });

  it("encerradas desde uma data, com aspas na JQL", async () => {
    const { calls, tracker } = fakeJira(() => Response.json({ issues: [] }));
    await tracker.listClosedTasksSince(new Date("2026-11-01T12:30:00Z"));
    expect(calls[0]!.body.jql).toBe('(project = ECH) AND statusCategory = Done AND updated >= "2026-11-01 12:29" ORDER BY updated DESC');
  });

  it("tarefa inexistente é null; outro erro vira JiraApiError com a mensagem do Jira", async () => {
    const missing = fakeJira(() => Response.json({ errorMessages: ["Issue does not exist"] }, { status: 404 }));
    expect(await missing.tracker.getTask("ECH-999")).toBeNull();
    const denied = fakeJira(() => Response.json({ errorMessages: ["Sem permissão"] }, { status: 403 }));
    await expect(denied.tracker.getTask("ECH-1")).rejects.toEqual(new JiraApiError(403, "Sem permissão"));
  });

  it("escritas: responsável pelo accountId e comentário em ADF", async () => {
    const { calls, tracker } = fakeJira((c) => (c.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ id: "c-1" })));
    await tracker.assignIssue("10042", "acc-carla");
    await tracker.assignIssue("10042", null);
    expect(await tracker.comment("10042", "Plano aprovado por Marina.\n\nMotivo: férias de Bruno.")).toEqual({ id: "c-1" });
    expect(calls[0]).toMatchObject({ method: "PUT", url: "https://acme.atlassian.net/rest/api/3/issue/10042/assignee", body: { accountId: "acc-carla" } });
    expect(calls[1]!.body).toEqual({ accountId: null });
    expect(calls[2]!.body.body).toEqual(adfText("Plano aprovado por Marina.\n\nMotivo: férias de Bruno."));
    expect(calls[2]!.body.body.content).toHaveLength(2);
    expect(tracker.platform).toBe("jira");
    expect(tracker.site).toBe("acme.atlassian.net");
  });
});

describe("Linear e Jira juntos", () => {
  const jiraEnv = { JIRA_BASE_URL: "https://acme.atlassian.net", JIRA_EMAIL: "echo@acme.test", JIRA_API_TOKEN: "token-de-teste" };
  it("só o Jira configurado: o Jira é o tracker", () => {
    const p = platformsFromEnv(jiraEnv);
    expect(p.jira?.site).toBe("acme.atlassian.net");
    expect(p.linear).toBeUndefined();
  });
  it("Linear e Jira configurados: os dois ficam ligados", () => {
    const p = platformsFromEnv({ ...jiraEnv, LINEAR_API_KEY: "lin_api_teste" });
    expect(p.linear).toBeDefined();
    expect(p.jira?.site).toBe("acme.atlassian.net");
  });
  it("a tarefa do Jira diz de onde veio", () => {
    expect(jiraTask({ id: "10042", key: "PAG-1", fields: { summary: "x", labels: [] } }).source).toBe("jira");
  });
  it("prefixos repetidos nos dois trackers aparecem no diagnóstico", () => {
    expect(sharedKeyPrefixes(["ECH-1", "ECH-2", "WEB-3"], ["PAG-1", "ech-9", "OPS-2"])).toEqual(["ECH"]);
    expect(sharedKeyPrefixes(["ECH-1"], ["PAG-1"])).toEqual([]);
    expect(keyPrefix("MEU-PROJ-12")).toBe("MEU-PROJ");
  });
});
