// Nota do dia (etapa 8): rascunho, mensagem pelo outbox, prazo de 2 h e confirmação só pela pessoa.
import type { OutboxAction } from "@echo/actions";
import type { BrainStore } from "@echo/brain";
import { DAY, FixedClock, HOUR, type DailyNote, type DailyNoteState, type Person, type PullRequest, type Task, type WorkEvent } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import { createAnswer, type ModelCall } from "./answer.ts";
import type { AgentData } from "./data.ts";
import { createEndOfDay, type DailyNoteStore, type NotePatch, ruleStoppedAt, type StoredDailyNote } from "./daily-note.ts";

const END = new Date("2026-11-06T21:05:00Z"); // sexta, 18h05 em Fortaleza
const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, orgId: "org", name, role: "member", teamId: "time", timezone: "America/Fortaleza", workHours: hours, skills: [], areas: [], active: true, ...extra });
const people = [person("fernando", "Fernando Neto"), person("eduardo", "Eduardo", { timezone: "Africa/Johannesburg" }), person("rita", "Rita", { role: "hr" })];

const tasks: Task[] = [
  { id: "t1", key: "ECH-128", title: "Tempo limite", assigneeId: "fernando", state: "in_progress", labels: [], hasLinearId: true },
  { id: "t2", key: "ECH-140", title: "Exportação", assigneeId: "fernando", state: "todo", dueDate: "2026-11-04", labels: [], hasLinearId: true },
];
const prs: PullRequest[] = [
  { id: "p44", repository: "echo-teste/app", number: 44, title: "Tempo limite", authorId: "fernando", state: "open", branch: "ech-128-tempo-limite", files: [], reviewerIds: [], openedAt: new Date(END.getTime() - 2 * DAY), taskKey: "ECH-128" },
];
const ev = (type: WorkEvent["type"], hoursAgo: number, extra: Partial<WorkEvent> = {}): WorkEvent => ({ type, personId: "fernando", repository: "echo-teste/app", occurredAt: new Date(END.getTime() - hoursAgo * HOUR), source: "github", sourceRef: `${type}:${hoursAgo}`, ...extra });

class MemoryNotes implements DailyNoteStore {
  notes = new Map<string, StoredDailyNote>();
  slack: Record<string, string> = { fernando: "U-FER", eduardo: "U-EDU" };
  private k = (p: string, d: string) => `${p}:${d}`;
  async get(p: string, d: string) { return this.notes.get(this.k(p, d)) ?? null; }
  async createDraft(note: DailyNote, createdAt: Date) {
    if (this.notes.has(this.k(note.personId, note.date))) return false;
    this.notes.set(this.k(note.personId, note.date), { ...note, state: "draft", createdAt });
    return true;
  }
  async setState(p: string, d: string, from: DailyNoteState[], to: DailyNoteState, patch: NotePatch = {}) {
    const n = this.notes.get(this.k(p, d));
    if (!n || !from.includes(n.state)) return false;
    this.notes.set(this.k(p, d), { ...n, ...patch, state: to });
    return true;
  }
  async slackUserOf(p: string) { return this.slack[p] ?? null; }
  async personBySlackUser(ext: string) { return Object.entries(this.slack).find(([, v]) => v === ext)?.[0] ?? null; }
  /** Como o pg-data: a última nota publicada (confirmada ou automática). */
  latestPublished(personId: string): DailyNote | null {
    const list = [...this.notes.values()].filter((n) => n.personId === personId && n.state !== "draft").sort((a, b) => (a.date < b.date ? 1 : -1));
    return list[0] ?? null;
  }
}

function setup(opts: { events?: WorkEvent[]; spent?: number; model?: ModelCall | null } = {}) {
  const clock = new FixedClock(END);
  const store = new MemoryNotes();
  const outbox: OutboxAction[] = [];
  const recorder = new LogRunRecorder();
  const events = opts.events ?? [ev("commit", 1, { branch: "ech-128-tempo-limite", taskKey: "ECH-128" }), ev("pr_opened", 48, { prNumber: 44 })];
  const data: AgentData = {
    orgSettings: async () => ({ monthlyLimitUsd: 50, hardLimitUsd: 100, repositoriesOpenToTeam: ["echo-teste/app"], teamLoadLimits: { time: 12 } }),
    spentUsdSince: async () => opts.spent ?? 0,
    people: async () => people,
    absences: async () => [],
    latestDailyNote: async (id) => store.latestPublished(id),
    task: async (key) => tasks.find((t) => t.key.toLowerCase() === key.toLowerCase()) ?? null,
    tasks: async (f) => tasks.filter((t) => !f.assigneeId || t.assigneeId === f.assigneeId),
    pullRequests: async (f) => prs.filter((p) => (!f.authorId || p.authorId === f.authorId) && (!f.branch || p.branch === f.branch)),
    lastCommitAt: async () => null,
    events: async (f) => events.filter((e) => (!f.personId || e.personId === f.personId) && e.occurredAt >= f.since),
    contributions: async () => [],
    expertiseOverrides: async () => [],
  };
  const flow = createEndOfDay({
    data: () => data,
    notes: () => store,
    outbox: () => ({
      enqueue: async (a) => {
        const dup = outbox.some((x) => x.idempotencyKey === a.idempotencyKey);
        if (!dup) outbox.push(a);
        return { id: a.idempotencyKey, duplicate: dup };
      },
    }),
    model: opts.model === undefined ? null : opts.model,
    recorder,
    clock,
    webUrl: "https://echo.test/",
  });
  return { flow, store, outbox, runs: recorder.runs, clock, data };
}

function haiku(text: string | Error) {
  const calls: Parameters<ModelCall>[0][] = [];
  const call: ModelCall = async (params) => {
    calls.push(params);
    if (text instanceof Error) throw text;
    return {
      id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null, context_management: null,
      usage: { input_tokens: 800, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "text", text: JSON.stringify({ parou_em: text }), citations: null }],
    } as never;
  };
  return { call, calls };
}

const confirmedBefore: StoredDailyNote = {
  personId: "fernando",
  date: "2026-11-05",
  released: [{ branch: "ech-131-api-v2", to: "eduardo", reason: "O formato da API está fechado." }],
  reserved: [{ branch: "ech-128-tempo-limite", reason: "Até a revisão do PR sair." }],
  state: "confirmed",
  confirmedAt: new Date("2026-11-05T21:30:00Z"),
  createdAt: new Date("2026-11-05T21:00:00Z"),
};

describe("rascunho do fim do expediente", () => {
  it("Haiku resume onde parou; regras apontam o que travou; liberado e reservado vêm só da pessoa", async () => {
    const m = haiku("ECH-128 com o PR 44 aberto; falta tratar o erro de tempo limite.");
    const { flow, store, outbox, runs } = setup({ model: m.call });
    store.notes.set("fernando:2026-11-05", confirmedBefore);

    const r = await flow.draft("org", "fernando", "2026-11-06");
    expect(r).toMatchObject({ status: "created", usedModel: true, dmQueued: true });
    const note = await store.get("fernando", "2026-11-06");
    expect(note).toMatchObject({
      state: "draft",
      stoppedAt: "ECH-128 com o PR 44 aberto; falta tratar o erro de tempo limite.",
      blocked: "PR 44 aguarda revisão, sem revisor definido; ECH-140 passou do prazo (04/11).",
      reserved: confirmedBefore.reserved,
      // A reserva vence a liberação na mesma branch; a liberação da ech-131 segue, com a confirmação original.
      released: [{ branch: "ech-131-api-v2", to: "eduardo", reason: "O formato da API está fechado.", confirmedAt: "2026-11-05T21:30:00.000Z" }],
    });

    // O modelo vê só fatos, como dado, sem horários; usa o Haiku.
    expect(m.calls[0]!.model).toBe("claude-haiku-5-5");
    expect(m.calls[0]!.tools).toBeUndefined();
    const sent = JSON.stringify(m.calls[0]!.messages);
    expect(sent).toContain("<dados>");
    expect(sent).not.toMatch(/2026-|occurredAt|T\d{2}:\d{2}/);

    // Mensagem privada pelo outbox, com Confirmar e Editar no painel.
    expect(outbox).toHaveLength(1);
    const dm = outbox[0]!;
    expect(dm).toMatchObject({ type: "slack.dm", target: "person:fernando", payload: { personId: "fernando" }, idempotencyKey: "daily_note:fernando:2026-11-06" });
    const payload = dm.payload as { text: string; blocks: { type: string; elements?: { action_id: string; value?: string; url?: string }[] }[] };
    expect(payload.text).toContain("*Liberado (ainda válido):* `ech-131-api-v2` para Eduardo (O formato da API está fechado)");
    expect(payload.text).toContain("*Reservado:* `ech-128-tempo-limite` (Até a revisão do PR sair)");
    expect(payload.text).toContain("Só você declara o que está liberado ou reservado.");
    const buttons = payload.blocks.find((b) => b.type === "actions")!.elements!;
    expect(buttons.map((b) => b.action_id)).toEqual(["confirmar_nota", "editar_nota", "abrir_resumo"]);
    expect(buttons[2]!.url).toBe("https://echo.test/resumos?data=2026-11-06");
    expect(JSON.parse(buttons[0]!.value!)).toEqual({ personId: "fernando", date: "2026-11-06" });
    expect(buttons[1]!.url).toBe("https://echo.test/nota-do-dia?data=2026-11-06");

    expect(runs[0]).toMatchObject({ flow: "daily_note", result: "ok", model: "claude-haiku-5-5", inputTokens: 800, outputTokens: 40, tools: ["slack.dm"] });
  });

  it.each([
    ["horário", "Fernando parou às 16h na ECH-128."],
    ["duração", "Passou 3 horas na ECH-128."],
    ["identificador inventado", "Parou na ECH-999, falta o deploy."],
    ["número solto", "ECH-128 com 2 testes falhando."],
    ["primeira pessoa", "Terminei a ECH-128 e deixei o PR 44 aberto."],
    ["liberação", "A ech-128-tempo-limite está liberada para Eduardo."],
    ["avaliação", "Fernando é um ótimo profissional e parou na ECH-128."],
  ])("o validador descarta %s e usa a regra", async (_c, text) => {
    const { flow, store, runs } = setup({ model: haiku(text).call });
    await flow.draft("org", "fernando", "2026-11-06");
    expect((await store.get("fernando", "2026-11-06"))!.stoppedAt).toBe("ECH-128 em andamento; PR 44 aberto na ech-128-tempo-limite.");
    expect(runs[0]).toMatchObject({ result: "fallback" });
    expect(runs[0]!.error).toMatch(/^validador/);
  });

  it("sem modelo, com a API fora ou acima do limite de custo: onde parou por regra", async () => {
    const none = setup();
    expect(await none.flow.draft("org", "fernando", "2026-11-06")).toMatchObject({ status: "created", usedModel: false });
    expect(none.runs[0]).toMatchObject({ result: "fallback", error: "sem modelo" });

    const down = setup({ model: haiku(new Error("overloaded")).call });
    await down.flow.draft("org", "fernando", "2026-11-06");
    expect(down.runs[0]).toMatchObject({ result: "fallback", error: "overloaded" });

    const m = haiku("ECH-128 em andamento.");
    const costly = setup({ model: m.call, spent: 50 });
    await costly.flow.draft("org", "fernando", "2026-11-06");
    expect(m.calls).toHaveLength(0);
    expect(costly.runs[0]).toMatchObject({ error: "teto de custo" });
  });

  it("sem evento nas últimas 24 h: sem rascunho nem mensagem, e a nota anterior continua valendo", async () => {
    const { flow, store, outbox, runs } = setup({ events: [ev("commit", 30)] });
    store.notes.set("fernando:2026-11-05", confirmedBefore);
    expect(await flow.draft("org", "fernando", "2026-11-06")).toEqual({ status: "skipped", reason: "sem evento nas últimas 24 horas" });
    expect(await store.get("fernando", "2026-11-06")).toBeNull();
    expect(outbox).toEqual([]);
    expect(store.latestPublished("fernando")?.date).toBe("2026-11-05");
    expect(runs[0]).toMatchObject({ flow: "daily_note", result: "skipped" });
  });

  it("chave única por pessoa e data: rodar de novo não cria outra nota nem outra mensagem", async () => {
    const { flow, outbox } = setup();
    await flow.draft("org", "fernando", "2026-11-06");
    expect(await flow.draft("org", "fernando", "2026-11-06")).toMatchObject({ status: "skipped", reason: "nota já existe nesta data" });
    expect(outbox).toHaveLength(1);
  });

  it("sem conta no Slack, o rascunho fica no painel; RH não tem nota", async () => {
    const { flow, store, outbox } = setup();
    store.slack = {};
    expect(await flow.draft("org", "fernando", "2026-11-06")).toMatchObject({ status: "created", dmQueued: false });
    expect(outbox).toEqual([]);
    expect(await flow.draft("org", "rita", "2026-11-06")).toMatchObject({ status: "skipped" });
  });

  it("número que já está no título da tarefa passa (API v2)", async () => {
    const { flow, store, runs } = setup({ model: haiku("ECH-128, tempo limite da API v2: falta abrir o PR.").call });
    tasks[0]!.title = "Tempo limite da API v2";
    try {
      await flow.draft("org", "fernando", "2026-11-06");
      expect((await store.get("fernando", "2026-11-06"))!.stoppedAt).toBe("ECH-128, tempo limite da API v2: falta abrir o PR.");
      expect(runs[0]!.result).toBe("ok");
    } finally {
      tasks[0]!.title = "Tempo limite";
    }
  });

  it("regra de onde parou: tarefas e PRs mais recentes primeiro", () => {
    expect(ruleStoppedAt({ pessoa: "F", eventos: [], tarefas_abertas: [], prs_abertos: [] })).toBe("Sem tarefa em andamento nem PR aberto registrado.");
  });
});

describe("prazo de 2 horas", () => {
  it("rascunho sem resposta vira auto_unreviewed só depois de 2 h", async () => {
    const { flow, store, clock, runs } = setup();
    await flow.draft("org", "fernando", "2026-11-06");
    clock.set(new Date(END.getTime() + HOUR));
    expect(await flow.expire("org", "fernando", "2026-11-06")).toEqual({ state: "draft", changed: false });
    clock.set(new Date(END.getTime() + 2 * HOUR));
    expect(await flow.expire("org", "fernando", "2026-11-06")).toEqual({ state: "auto_unreviewed", changed: true });
    expect((await store.get("fernando", "2026-11-06"))!.state).toBe("auto_unreviewed");
    expect(runs.filter((r) => r.flow === "daily_note_timeout").map((r) => r.result)).toEqual(["skipped", "ok"]);
  });

  it("nota confirmada não vira automática", async () => {
    const { flow, clock } = setup();
    await flow.draft("org", "fernando", "2026-11-06");
    await flow.confirm("org", "fernando", "fernando", "2026-11-06");
    clock.set(new Date(END.getTime() + 3 * HOUR));
    expect(await flow.expire("org", "fernando", "2026-11-06")).toEqual({ state: "confirmed", changed: false });
  });
});

describe("confirmação", () => {
  const click = (user: string, value = JSON.stringify({ personId: "fernando", date: "2026-11-06" })) => ({ type: "block_actions", user: { id: user }, actions: [{ action_id: "confirmar_nota", value }] });

  it("só a dona confirma pelo Slack; clique repetido não muda nada", async () => {
    const { flow, store, runs } = setup();
    await flow.draft("org", "fernando", "2026-11-06");
    expect(await flow.confirmFromSlack("org", click("U-EDU"))).toMatchObject({ status: "denied" });
    expect(await flow.confirmFromSlack("org", click("U-DESCONHECIDO"))).toMatchObject({ status: "denied" });
    expect((await store.get("fernando", "2026-11-06"))!.state).toBe("draft");
    expect(await flow.confirmFromSlack("org", click("U-FER"))).toMatchObject({ status: "confirmed" });
    expect((await store.get("fernando", "2026-11-06"))!).toMatchObject({ state: "confirmed", confirmedAt: END });
    expect(await flow.confirmFromSlack("org", click("U-FER"))).toMatchObject({ status: "already" });
    expect(await flow.confirmFromSlack("org", { type: "block_actions", user: { id: "U-FER" }, actions: [{ action_id: "resolveu" }] })).toBeNull();
    expect(runs.filter((r) => r.flow === "daily_note_confirm").map((r) => r.result)).toEqual(["refused", "refused", "ok", "skipped"]);
  });

  it("a nota automática ainda pode ser confirmada pela pessoa", async () => {
    const { flow, clock } = setup();
    await flow.draft("org", "fernando", "2026-11-06");
    clock.set(new Date(END.getTime() + 2 * HOUR));
    await flow.expire("org", "fernando", "2026-11-06");
    expect(await flow.confirm("org", "fernando", "fernando", "2026-11-06")).toMatchObject({ status: "confirmed" });
  });

  it("edição no painel: limpa os campos, ignora pessoa de fora e não deixa forjar a data de confirmação", async () => {
    const { flow, store } = setup();
    store.notes.set("fernando:2026-11-05", confirmedBefore);
    await flow.draft("org", "fernando", "2026-11-06");
    await flow.confirm("org", "fernando", "fernando", "2026-11-06", {
      released: [
        { branch: "ech-131-api-v2", to: "eduardo", confirmedAt: "2026-11-05T21:30:00.000Z" },
        { branch: " ech-150-busca ", to: "estranho", confirmedAt: "2030-01-01T00:00:00Z" },
        { branch: "" },
      ],
    });
    expect((await store.get("fernando", "2026-11-06"))!.released).toEqual([
      { branch: "ech-131-api-v2", to: "eduardo", confirmedAt: "2026-11-05T21:30:00.000Z" },
      { branch: "ech-150-busca" },
    ]);
  });
});

describe("pronto quando: uma nota confirmada muda a resposta do agente", () => {
  const brain: BrainStore = { get: async () => null, search: async () => [], write: async () => { throw new Error("somente leitura"); }, history: async () => [] };

  it("liberação declarada no painel só vale depois de confirmada; nota automática não libera", async () => {
    const { flow, data, clock } = setup();
    const answer = createAnswer({ data: () => data, brain: () => brain, model: null, recorder: new LogRunRecorder(), clock });
    const ask = () => answer({ orgId: "org", askerId: "eduardo", ownerId: "fernando", text: "a ech-150-busca está liberada?", channel: "painel" });

    await flow.draft("org", "fernando", "2026-11-06");
    expect((await ask()).text).not.toMatch(/está liberada/);

    // Nota automática com liberação que a pessoa não confirmou: continua sem liberação.
    clock.set(new Date(END.getTime() + 2 * HOUR));
    await flow.expire("org", "fernando", "2026-11-06");
    const store = (await flow.confirm("org", "eduardo", "fernando", "2026-11-06", { released: [{ branch: "ech-150-busca", to: "eduardo" }] }));
    expect(store.status).toBe("denied");
    expect((await ask()).text).not.toMatch(/está liberada/);

    // A pessoa edita e confirma: a resposta muda.
    await flow.confirm("org", "fernando", "fernando", "2026-11-06", { released: [{ branch: "ech-150-busca", to: "eduardo", reason: "A busca já tem testes." }] });
    const after = await ask();
    expect(after.text).toMatch(/^A ech-150-busca está liberada para Eduardo/);
    expect(after.sources.map((s) => s.ref)).toContain("daily_note:fernando:2026-11-06");
  });
});
