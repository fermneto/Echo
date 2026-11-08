// Trocar o bonequinho: pela foto (Claude) ou à mão, com limite, audit_log e uma linha em agent_runs.
import type { AvatarTraits } from "@echo/domain";
import { LogRunRecorder } from "@echo/observability";
import { describe, expect, it } from "vitest";
import type { ModelCall } from "./answer.ts";
import { adjustAvatar, type AvatarStore, REDO_LIMIT, redoAvatar } from "./redo-avatar.ts";

const before: AvatarTraits = { hair: "short", hairColor: "brown", skin: "s3", eyewear: "none", facialHair: "none", top: "tshirt", topColor: "gray", headwear: "none" };
const after: AvatarTraits = { hair: "curly", hairColor: "auburn", skin: "s2", eyewear: "glasses", facialHair: "none", top: "hoodie", topColor: "green", headwear: "none" };
const PHOTO = { mediaType: "image/jpeg" as const, base64: "/9j/AA==" };
const input = { orgId: "org", personId: "p-1", actorId: "rh-1", photo: PHOTO };

function store(opts: { exists?: boolean; redos?: number } = {}) {
  const updates: { traits: AvatarTraits; actorId: string; action: string }[] = [];
  const s: AvatarStore = {
    current: async () => (opts.exists === false ? undefined : before),
    update: async (_o, _p, traits, actorId, action) => (updates.push({ traits, actorId, action }), true),
    recentRedos: async () => opts.redos ?? 0,
  };
  return { s, updates };
}

function haiku(out: unknown, stop = "end_turn") {
  const calls: unknown[] = [];
  const call: ModelCall = async (params) => {
    calls.push(params);
    return {
      id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: stop, stop_sequence: null, stop_details: null, container: null, context_management: null,
      usage: { input_tokens: 1600, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out), citations: null }],
    } as never;
  };
  return { call, calls };
}

describe("refazer o bonequinho pela foto", () => {
  it("foto nova vira traços novos, com audit_log de quem trocou", async () => {
    const { s, updates } = store();
    const recorder = new LogRunRecorder();
    const r = await redoAvatar({ store: s, vision: haiku(after).call, recorder })(input);
    expect(r).toEqual({ status: "saved", traits: after, kept: [] });
    expect(updates).toEqual([{ traits: after, actorId: "rh-1", action: "avatar:refazer" }]);
    expect(recorder.runs[0]).toMatchObject({ flow: "avatar_redo", result: "ok", model: "claude-haiku-5-5" });
    expect(recorder.runs[0]!.costUsd).toBeGreaterThan(0);
    expect(JSON.stringify(recorder.runs)).not.toContain("/9j/");
  });

  it("traço fora da lista fica como estava", async () => {
    const { s, updates } = store();
    const r = await redoAvatar({ store: s, vision: haiku({ ...after, skin: "morena" }).call, recorder: new LogRunRecorder() })(input);
    expect(r).toEqual({ status: "saved", traits: { ...after, skin: before.skin }, kept: ["skin"] });
    expect(updates[0]!.traits.skin).toBe("s3");
  });

  it("recusa, saída sem nenhum traço ou erro do modelo: nada muda", async () => {
    for (const vision of [haiku("", "refusal").call, haiku("não sei").call, (async () => { throw new Error("529 sobrecarregado"); }) as ModelCall]) {
      const { s, updates } = store();
      const recorder = new LogRunRecorder();
      expect(await redoAvatar({ store: s, vision, recorder })(input)).toEqual({ status: "unreadable" });
      expect(updates).toHaveLength(0);
      expect(recorder.runs).toHaveLength(1);
    }
  });

  it("sem chave, limite por hora ou pessoa de fora: não chama o modelo", async () => {
    const vision = haiku(after);
    expect(await redoAvatar({ store: store().s, vision: null, recorder: new LogRunRecorder() })(input)).toEqual({ status: "no_model" });
    expect(await redoAvatar({ store: store({ redos: REDO_LIMIT.perHour }).s, vision: vision.call, recorder: new LogRunRecorder() })(input)).toEqual({ status: "limit" });
    expect(await redoAvatar({ store: store({ exists: false }).s, vision: vision.call, recorder: new LogRunRecorder() })(input)).toEqual({ status: "not_found" });
    expect(vision.calls).toHaveLength(0);
  });
});

describe("ajustar o bonequinho à mão", () => {
  it("só valores da lista; grava com audit_log próprio", async () => {
    const { s, updates } = store();
    const recorder = new LogRunRecorder();
    const adjust = adjustAvatar({ store: s, recorder });
    expect(await adjust({ orgId: "org", personId: "p-1", actorId: "p-1", traits: after })).toEqual({ status: "saved", traits: after, kept: [] });
    expect(updates[0]!.action).toBe("avatar:ajustar");
    expect(recorder.runs[0]).toMatchObject({ flow: "avatar_adjust", result: "ok" });
    expect(await adjust({ orgId: "org", personId: "p-1", actorId: "p-1", traits: { ...after, hair: "moicano" } })).toEqual({ status: "invalid" });
    expect(updates).toHaveLength(1);
  });
});
