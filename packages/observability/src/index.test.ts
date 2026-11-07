import { describe, expect, it } from "vitest";
import { LogRunRecorder, initTracing, withRun } from "./index.ts";

describe("withRun", () => {
  it("registra execução bem-sucedida com duração", async () => {
    const rec = new LogRunRecorder();
    const v = await withRun(rec, "teste", async () => 42, { model: "nenhum" });
    expect(v).toBe(42);
    expect(rec.runs).toHaveLength(1);
    expect(rec.runs[0]).toMatchObject({ flow: "teste", result: "ok", model: "nenhum" });
    expect(rec.runs[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("registra falha e repassa o erro", async () => {
    const rec = new LogRunRecorder();
    await expect(withRun(rec, "teste", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(rec.runs[0]).toMatchObject({ flow: "teste", result: "failed", error: "boom" });
  });
});

describe("initTracing", () => {
  it("não liga nada sem chaves", async () => {
    const flush = initTracing({});
    await expect(flush()).resolves.toBeUndefined();
  });
});
