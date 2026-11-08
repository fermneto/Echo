// Vídeo da semana da equipe: textos conferidos (com regra de reserva), trechos com roteiro conferido, gravação
// conferida fora do ambiente, falhas sem travar nada e uma linha por etapa em agent_runs.
import type { AvatarTraits, TeamWeekFacts, VideoCandidate } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import type { ModelCall } from "./answer.ts";
import { createVideo, finalScenes, prepareTeamVideo, type RecordResult, type TeamVideoPatch, type TeamVideoRow, type TeamVideoState, type TeamVideoStore, type VideoSandbox } from "./video.ts";
import { mp4DurationSeconds } from "./video-clip.ts";

/** mp4 mínimo: ftyp + moov com mvhd (versão 0). */
function mp4(seconds: number, timescale = 1000): Uint8Array {
  const box = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(8 + body.length);
    new DataView(out.buffer).setUint32(0, out.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(body, 8);
    return out;
  };
  const mvhd = new Uint8Array(100);
  const v = new DataView(mvhd.buffer);
  v.setUint32(12, timescale);
  v.setUint32(16, Math.round(seconds * timescale));
  const ftyp = box("ftyp", new Uint8Array([105, 115, 111, 109, 0, 0, 0, 0]));
  const moov = box("moov", box("mvhd", mvhd));
  const out = new Uint8Array(ftyp.length + moov.length);
  out.set(ftyp);
  out.set(moov, ftyp.length);
  return out;
}

const a = { hair: "short", hairColor: "brown", skin: "s3", eyewear: "none", facialHair: "none", top: "tshirt", topColor: "blue", headwear: "none" } as AvatarTraits;
const facts: TeamWeekFacts = {
  teamName: "Produto",
  weekLabel: "2 a 6/11",
  people: [{ id: "fer", name: "Fernando", avatar: a }, { id: "car", name: "Carla", avatar: a }],
  deliveries: [{ ref: "ECH-128", title: "Tempo limite", personId: "fer" }],
  helps: [{ fromId: "car", toId: "fer", count: 1 }],
  twins: { answered: 4, peopleIds: ["fer"] },
  clips: [],
};
const PREVIEW = "https://sha41.vercel.app";
const candidate: VideoCandidate = { pr: { id: "pr", repository: "echo/app", number: 41, title: "Tela de pagamentos", authorId: "fer", state: "merged", branch: "b", files: ["apps/web/app/pagamentos/page.tsx"], reviewerIds: [], taskKey: "ECH-128" }, previewUrl: PREVIEW };
const goodTexts = { opening: "A semana da equipe Produto", deliveries: "Uma entrega chegou ao fim", helps: "Ajudas destravaram o trabalho", twins: "Os gêmeos responderam 4 perguntas", closing: "Bom fim de semana" };
const goodScript = { title: "Tela de pagamentos do PR 41", startUrl: `${PREVIEW}/pagamentos`, steps: [{ action: "goto", url: `${PREVIEW}/pagamentos`, target: null, value: null, key: null, seconds: null, caption: "Abre a tela de pagamentos" }] };

/** Modelo falso: devolve os textos ou o roteiro, conforme o pedido (o roteiro pede `telas` nos dados). */
function model(opts: { texts?: unknown; script?: unknown; fail?: boolean } = {}) {
  const calls: string[] = [];
  const call: ModelCall = async (params) => {
    const isScript = JSON.stringify(params.messages).includes("telas");
    calls.push(isScript ? "roteiro" : "textos");
    if (opts.fail) throw new Error("529 sobrecarregado");
    const out = isScript ? (opts.script ?? goodScript) : (opts.texts ?? goodTexts);
    return {
      id: "m", type: "message", role: "assistant", model: isScript ? "claude-sonnet-5-5" : "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, stop_details: null, container: null, context_management: null,
      usage: { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "text", text: JSON.stringify(out), citations: null }],
    } as never;
  };
  return { call, calls };
}

function store(row: Partial<TeamVideoRow> = {}, budget = { spentUsd: 1, monthlyLimitUsd: 50 }, withFacts = true) {
  const r: TeamVideoRow = { id: "v1", orgId: "org", teamId: "t1", week: "2026-W45", state: "queued", attempts: 0, storageKey: null, ...row };
  const patches: { from: TeamVideoState; to: TeamVideoState; patch: TeamVideoPatch }[] = [];
  const s: TeamVideoStore = {
    facts: async () => (withFacts ? { facts, candidates: [candidate] } : null),
    get: async () => ({ ...r }),
    transition: async (_o, _id, from, to, patch = {}) => {
      if (r.state !== from) return false;
      patches.push({ from, to, patch });
      r.state = to;
      return true;
    },
    budget: async () => budget,
  };
  return { s, patches };
}

function sandbox(result: Partial<RecordResult> = {}, seconds = 40) {
  const inputs: { html: string; clips: unknown[] }[] = [];
  const deleted: string[] = [];
  const sb: VideoSandbox = { record: async (input) => (inputs.push(input), { sessionId: "sesn_1", outcome: "done", video: { fileId: "file_mp4", bytes: mp4(seconds) }, meta: { visited: [`${PREVIEW}/pagamentos`, "file:///tmp/semana/semana.html"], clips: [0] }, costUsd: 0.3, ...result }) };
  return { sb, inputs, deleted, deleteFile: async (id: string) => void deleted.push(id) };
}

describe("duração do mp4", () => {
  it("lê o mvhd; arquivo sem moov não tem duração", () => {
    expect(mp4DurationSeconds(mp4(42.5))).toBeCloseTo(42.5);
    expect(mp4DurationSeconds(new Uint8Array([0, 0, 0, 8, 102, 114, 101, 101]))).toBeNull();
  });
});

describe("preparação do vídeo da semana", () => {
  it("textos do modelo conferidos, trecho com roteiro conferido e a página com as cenas", async () => {
    const m = model();
    const recorder = new LogRunRecorder();
    const p = await prepareTeamVideo(m.call, facts, [candidate], recorder, "org");
    expect(p.story.textsBy).toBe("model");
    expect(p.story.texts.opening).toBe("A semana da equipe Produto");
    expect(p.clips).toHaveLength(1);
    expect(p.story.facts.clips).toEqual([{ ref: "ECH-128", title: "Tela de pagamentos", file: "clips/0.webm" }]);
    expect(p.story.scenes.find((s) => s.kind === "clip")!.narration).toBe("Uma das telas novas: Tela de pagamentos.");
    expect(p.story.scenes.map((s) => s.kind)).toEqual(["opening", "numbers", "deliveries", "clip", "helps", "twins", "closing"]);
    expect(p.hosts).toEqual(["sha41.vercel.app"]);
    expect(p.html).toContain("A semana da equipe Produto");
    expect(p.html).toContain('src="clips/0.webm"');
    expect(recorder.runs.map((r) => [r.flow, r.result])).toEqual([["team_video_texts", "ok"], ["video_script", "ok"]]);
  });

  it("texto com ranking ou número inventado: vale o texto por regra; roteiro fora do preview: trecho fica de fora", async () => {
    const m = model({ texts: { ...goodTexts, helps: "Carla foi a melhor da semana" }, script: { ...goodScript, startUrl: "https://app.echo.com.br" } });
    const recorder = new LogRunRecorder();
    const p = await prepareTeamVideo(m.call, facts, [candidate], recorder);
    expect(p.story.textsBy).toBe("rule");
    expect(p.html).not.toContain("melhor");
    expect(p.clips).toEqual([]);
    expect(p.story.scenes.map((s) => s.kind)).not.toContain("clip");
    expect(recorder.runs.map((r) => r.result)).toEqual(["fallback", "failed"]);
  });

  it("modelo fora do ar: textos por regra e nenhum trecho, sem quebrar", async () => {
    const p = await prepareTeamVideo(model({ fail: true }).call, facts, [candidate], new LogRunRecorder());
    expect(p.story.textsBy).toBe("rule");
    expect(p.clips).toEqual([]);
  });
});

describe("gravação do vídeo da semana", () => {
  it("caminho feliz: fila, gravação conferida e pronto, com capítulos das cenas e retenção", async () => {
    const st = store();
    const sb = sandbox();
    const recorder = new LogRunRecorder();
    const r = await createVideo({ store: st.s, sandbox: sb.sb, deleteFile: sb.deleteFile, model: model().call, recorder, clock: { now: () => new Date("2026-11-07T12:00:00Z") } }).process("org", "v1");
    expect(r).toEqual({ status: "ready", id: "v1" });
    expect(st.patches.map((p) => `${p.from}>${p.to}`)).toEqual(["queued>recording", "recording>ready"]);
    const ready = st.patches[1]!.patch;
    expect(ready).toMatchObject({ storageKey: "file_mp4", durationS: 40, costUsd: 0.3, sessionId: "sesn_1", expiresAt: new Date("2026-12-07T12:00:00Z") });
    expect(ready.chapters!.map((c) => c.title)).toEqual(["Abertura", "A semana em números", "Entregas", "Tela de pagamentos", "Ajudas entre colegas", "Gêmeos em ação", "Encerramento"]);
    expect(sb.inputs[0]!.clips).toHaveLength(1);
    expect(recorder.runs.at(-1)).toMatchObject({ flow: "team_video", result: "ok", costUsd: 0.3 });
  });

  it("vídeo curto demais ou que saiu do preview: recusado e o arquivo sai do armazenamento", async () => {
    for (const result of [{ video: { fileId: "f_curto", bytes: mp4(5) } }, { meta: { visited: ["https://evil.example"] } }]) {
      const st = store();
      const sb = sandbox(result);
      const r = await createVideo({ store: st.s, sandbox: sb.sb, deleteFile: sb.deleteFile, model: model().call, recorder: new LogRunRecorder() }).process("org", "v1");
      expect(r.status).toBe("failed");
      expect(sb.deleted).toHaveLength(1);
      expect(st.patches.at(-1)!.to).toBe("failed");
    }
  });

  it("sessão sem vídeo ou estourada: falha com motivo", async () => {
    const st = store();
    const r = await createVideo({ store: st.s, sandbox: sandbox({ outcome: "budget_reached", video: null }).sb, model: model().call, recorder: new LogRunRecorder() }).process("org", "v1");
    expect(r).toMatchObject({ status: "failed", reason: "limite de custo da gravação atingido" });
  });

  it("80% do limite, desligado, fora da fila, sem relatórios ou limite de gravações: não abre sessão", async () => {
    const sb = sandbox();
    const m = model();
    expect(await createVideo({ store: store({}, { spentUsd: 41, monthlyLimitUsd: 50 }).s, sandbox: sb.sb, model: m.call, recorder: new LogRunRecorder() }).process("org", "v1")).toMatchObject({ status: "skipped" });
    expect(await createVideo({ store: store().s, recorder: new LogRunRecorder() }).process("org", "v1")).toMatchObject({ status: "skipped" });
    expect(await createVideo({ store: store({ state: "ready" }).s, sandbox: sb.sb, model: m.call, recorder: new LogRunRecorder() }).process("org", "v1")).toMatchObject({ status: "skipped" });
    expect(await createVideo({ store: store({}, undefined, false).s, sandbox: sb.sb, model: m.call, recorder: new LogRunRecorder() }).process("org", "v1")).toMatchObject({ status: "failed", reason: "equipe sem relatórios nesta semana" });
    expect(await createVideo({ store: store({ attempts: 3 }).s, sandbox: sb.sb, model: m.call, recorder: new LogRunRecorder() }).process("org", "v1")).toMatchObject({ status: "failed", reason: "limite de gravações" });
    expect(sb.inputs).toHaveLength(0);
    expect(m.calls).toHaveLength(0);
  });
});

describe("pausa por custo", () => {
  it("paused segue o limite do mês: em 80% pausa, abaixo libera; o processo grava um skipped só para o job já posto", async () => {
    const recorder = new LogRunRecorder();
    const v = createVideo({ store: store({}, { spentUsd: 40, monthlyLimitUsd: 50 }).s, sandbox: sandbox().sb, model: model().call, recorder });
    expect(await v.paused("org")).toBe(true);
    expect(await createVideo({ store: store({}, { spentUsd: 39, monthlyLimitUsd: 50 }).s, recorder }).paused("org")).toBe(false);
    expect(await v.process("org", "v1")).toMatchObject({ status: "skipped" });
    expect(recorder.runs.map((r) => [r.flow, r.result])).toEqual([["team_video", "skipped"]]);
  });
});

describe("cards de entrega", () => {
  it("mostram só a referência e o título, sem nome nem bonequinho do autor; as ajudas seguem com os nomes", async () => {
    const two: TeamWeekFacts = { ...facts, deliveries: [{ ref: "ECH-128", title: "Tempo limite", personId: "fer" }, { ref: "echo/app#63", title: "Bonequinho", personId: "fer" }] };
    const p = await prepareTeamVideo(model().call, two, [], new LogRunRecorder());
    const cards = [...p.html.matchAll(/<li class="card"[^]*?<\/li>/g)].map((m) => m[0]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain("Tempo limite");
    expect(cards[1]).toContain("Bonequinho");
    for (const c of cards) {
      expect(c).not.toContain("Fernando");
      expect(c).not.toContain("card__by");
      expect(c).not.toContain("<svg");
    }
    expect(p.html).toContain("<b>Carla</b> ajudou <b>Fernando</b>");
  });
});

describe("tempos finais com a voz", () => {
  it("aceita cena esticada pela voz; nunca encurta; meta torto fica no planejado", async () => {
    const p = await prepareTeamVideo(model().call, facts, [], new LogRunRecorder());
    const planned = p.story.scenes;
    const stretched = planned.map((s, i) => ({ at: 0, seconds: i === 0 ? s.seconds + 3 : s.seconds }));
    const out = finalScenes(planned, { timings: stretched });
    expect(out[0]!.seconds).toBeCloseTo(planned[0]!.seconds + 3);
    expect(out[1]!.at).toBeCloseTo(planned[1]!.at + 3);
    expect(finalScenes(planned, { timings: planned.map((s) => ({ seconds: s.seconds - 2 })) }).map((s) => s.seconds)).toEqual(planned.map((s) => s.seconds));
    expect(finalScenes(planned, { timings: [] })).toEqual(planned);
    expect(finalScenes(planned, null)).toEqual(planned);
  });
});
