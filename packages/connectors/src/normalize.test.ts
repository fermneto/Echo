import { describe, expect, it } from "vitest";
import { ghPr, ghPush, ghReview, linearIssue, slackEnvelope } from "./fixtures.ts";
import { githubRouteKey, normalizeGithub, parseCoauthors } from "./github.ts";
import { linearRouteKey, linearState, normalizeLinear } from "./linear.ts";
import { taskKeyFrom } from "./normalized.ts";
import { isWhoKnows, normalizeSlack, slackShouldKeep } from "./slack.ts";

describe("taskKeyFrom", () => {
  it("tira a tarefa do nome da branch ou do título", () => {
    expect(taskKeyFrom("ech-128-tempo-limite")).toBe("ECH-128");
    expect(taskKeyFrom("main", "Corrige ECH-7 no login")).toBe("ECH-7");
    expect(taskKeyFrom("main", "sem tarefa")).toBeUndefined();
  });
});

describe("normalizeGithub", () => {
  it("push vira um commit por item, com autor só quando o GitHub ligou a conta", () => {
    const out = normalizeGithub("push", ghPush());
    expect(out).toHaveLength(2);
    const [a, b] = out.map((e) => (e.kind === "work_event" ? e.event : null));
    expect(a).toMatchObject({ type: "commit", branch: "ech-128-tempo-limite", taskKey: "ECH-128", sourceRef: "commit:a1b2c3", actor: { login: "Fernando-Dev" } });
    expect(b!.actor).toBeUndefined();
    expect(githubRouteKey(ghPush())).toBe("555");
  });

  it("coautor pelo e-mail noreply vira login; o e-mail não é guardado", () => {
    const [c] = parseCoauthors("x\n\nCo-authored-by: Carla <123+carla-dev@users.noreply.github.com>");
    expect(c).toMatchObject({ name: "Carla", login: "carla-dev" });
    expect(JSON.stringify(c)).not.toContain("@");
  });

  it("PR aberto gera espelho e evento; fechado com merge gera pr_merged", () => {
    const opened = normalizeGithub("pull_request", ghPr("opened"));
    expect(opened.map((e) => e.kind)).toEqual(["pr_upsert", "work_event"]);
    const merged = normalizeGithub("pull_request", ghPr("closed", { state: "closed", merged: true, merged_at: "2026-11-07T10:00:00Z" }));
    expect(merged[0]).toMatchObject({ kind: "pr_upsert", pr: { state: "merged", taskKey: "ECH-128" } });
    expect(merged[1]).toMatchObject({ kind: "work_event", event: { type: "pr_merged" } });
  });

  it("revisão submetida vira fato; eventos não usados são ignorados", () => {
    expect(normalizeGithub("pull_request_review", ghReview())[0]).toMatchObject({ kind: "work_event", event: { type: "review", sourceRef: "review:9001" } });
    expect(normalizeGithub("star", { repository: { full_name: "x" } })[0]!.kind).toBe("ignored");
    expect(normalizeGithub("push", ghPush({ ref: "refs/tags/v1" }))[0]!.kind).toBe("ignored");
  });
});

describe("normalizeLinear", () => {
  it("mapeia estados, incluindo revisão", () => {
    expect(linearState("started", "In Review")).toBe("in_review");
    expect(linearState("started", "In Progress")).toBe("in_progress");
    expect(linearState("unstarted")).toBe("todo");
    expect(linearState("triage")).toBe("backlog");
  });

  it("tarefa vira espelho com tamanho, prazo, etiquetas e responsável externo", () => {
    const [t] = normalizeLinear(linearIssue());
    expect(t).toMatchObject({ kind: "task_upsert", task: { key: "ECH-128", state: "in_progress", size: 3, dueDate: "2026-11-13", labels: ["pagamentos"], assignee: { externalId: "lin-user-fer" } } });
    expect(linearRouteKey(linearIssue())).toBe("lin-org-1");
  });

  it("conclusão só gera task_done quando o estado mudou", () => {
    const done = normalizeLinear({ ...linearIssue({ state: { type: "completed", name: "Done" }, completedAt: "2026-11-07T07:00:00Z" }), updatedFrom: { stateId: "x" } });
    expect(done[1]).toMatchObject({ kind: "work_event", event: { type: "task_done", taskKey: "ECH-128" } });
    const titleOnly = normalizeLinear({ ...linearIssue({ state: { type: "completed", name: "Done" } }), updatedFrom: { title: "antigo" } });
    expect(titleOnly).toHaveLength(1);
  });

  it("ignora o que não é tarefa", () => expect(normalizeLinear({ type: "Comment" })[0]!.kind).toBe("ignored"));
});

describe("slackShouldKeep (descarte na entrada, sem gravar)", () => {
  const ctx = { botUserId: "UBOT", registeredUserIds: new Set(["UFER", "UEDU"]) };
  const msg = (text: string, extra: Record<string, unknown> = {}) => ({ type: "message", text, user: "UEDU", channel: "C1", ts: "1.1", ...extra });

  it("guarda menção a pessoa cadastrada, quem sabe, DM e tópico do Echo", () => {
    expect(slackShouldKeep(msg("<@UFER> posso seguir com a ech-131?"), ctx).keep).toBe(true);
    expect(slackShouldKeep(msg("alguém sabe de pagamentos?"), ctx).keep).toBe(true);
    expect(slackShouldKeep(msg("oi", { channel_type: "im" }), ctx).keep).toBe(true);
    expect(slackShouldKeep(msg("e a ECH-160?", { thread_ts: "0.9", parent_user_id: "UBOT" }), ctx).keep).toBe(true);
    expect(slackShouldKeep({ type: "app_mention", text: "<@UBOT> quem está livre?" }, ctx).keep).toBe(true);
  });

  it("descarta conversa entre pessoas, bots, edições, pessoa não cadastrada e cópia da menção ao bot", () => {
    expect(slackShouldKeep(msg("bom dia time"), ctx).keep).toBe(false);
    expect(slackShouldKeep(msg("<@UFER> oi", { bot_id: "B1" }), ctx).keep).toBe(false);
    expect(slackShouldKeep(msg("<@UFER> oi", { subtype: "message_changed" }), ctx).keep).toBe(false);
    expect(slackShouldKeep(msg("<@UXYZ> oi"), ctx).keep).toBe(false);
    expect(slackShouldKeep(msg("<@UBOT> oi"), ctx)).toEqual({ keep: false, reason: "coberta por app_mention" });
  });

  it("proposta que cita uma pessoa só pelo nome passa; conversa comum com o nome, não", () => {
    const named = { ...ctx, registeredPeople: [{ id: "UFER", name: "Fernando Neto" }, { id: "UEDU", name: "Eduardo" }] };
    expect(slackShouldKeep(msg("que tal o Fernando revisar a API amanhã?"), named)).toEqual({ keep: true, reason: "proposta citada pelo nome" });
    expect(slackShouldKeep(msg("o Fernando terminou a API"), named).keep).toBe(false);
    expect(slackShouldKeep(msg("proponho que eu, Eduardo, revise"), named).keep).toBe(false); // o próprio autor
    expect(slackShouldKeep(msg("que tal o Fernando revisar a API amanhã?"), ctx).keep).toBe(false); // sem os nomes
  });

  it("quem sabe no sentido de talvez é ignorado", () => {
    expect(isWhoKnows("quem sabe amanhã a gente vê")).toBe(false);
    expect(isWhoKnows("Quem entende de Kubernetes?")).toBe(true);
  });

  it("só reações de ajuda passam", () => {
    expect(slackShouldKeep({ type: "reaction_added", reaction: "pray" }, ctx).keep).toBe(true);
    expect(slackShouldKeep({ type: "reaction_added", reaction: "eyes" }, ctx).keep).toBe(false);
  });
});

describe("normalizeSlack", () => {
  it("separa a menção ao bot das menções a pessoas", () => {
    const [m] = normalizeSlack(slackEnvelope({ type: "app_mention", text: "<@UBOT> o que a <@UCAR> fez ontem?", user: "UMAR", channel: "C1", ts: "1.2" }), "UBOT");
    expect(m).toMatchObject({ kind: "chat_message", message: { mentionsBot: true, mentions: ["UCAR"], userExternalId: "UMAR" } });
  });

  it("reação vira referência com autor e quem reagiu, sem texto", () => {
    const [r] = normalizeSlack(slackEnvelope({ type: "reaction_added", user: "UBRU", reaction: "pray", item_user: "UCAR", item: { type: "message", channel: "C1", ts: "5.5" }, event_ts: "1762500000.1" }));
    expect(r).toMatchObject({ kind: "reaction", reactorExternalId: "UBRU", authorExternalId: "UCAR", channel: "C1", ts: "5.5" });
  });
});
