import { describe, expect, it, vi } from "vitest";
import type { Persona } from "./demo/types";
import { loadMorningPlan, loadWaiting, planDate, planItemView, waitingView } from "./pending-live";

const me: Persona = {
  id: "11111111-1111-4111-8111-111111111111",
  orgId: "org-real",
  name: "Ana Prado",
  role: "member",
  timezone: "America/Fortaleza",
  workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
  skills: [],
  areas: [],
  active: true,
  title: "",
  story: "",
  city: "Fortaleza",
  cityCode: "FOR",
  availability: { kind: "working" },
};

describe("Tasks aguardando você, do banco", () => {
  it("cada pendência diz o que é, há quanto espera e onde se resolve", () => {
    expect(waitingView({ id: "review:teste/app#13", kind: "review_request", text: "PR 13 de Beto espera sua revisão", reason: "revisão pedida a você, há 3 dias", ref: "github:pr/13" })).toEqual({
      key: "review:teste/app#13",
      id: "PR 13",
      text: "PR 13 de Beto espera sua revisão",
      since: "revisão pedida a você, há 3 dias",
      detail: "A revisão deste PR foi pedida a você no GitHub.",
      action: { label: "Ver no meu plano", href: "/plano" },
    });
    expect(waitingView({ id: "note:2026-11-06", kind: "daily_note", text: "Nota do dia de 06/11 esperando a sua confirmação", reason: "foi enviada sem revisão; confirme ou corrija", ref: "note:2026-11-06" })).toMatchObject({
      id: "Nota do dia",
      action: { href: "/nota-do-dia" },
    });
    expect(waitingView({ id: "fix:f1", kind: "fix_ready", text: "Correção pronta no seu PR 12, aguardando sua aprovação", reason: "x", ref: "fix:f1" }).id).toBe("Correção");
  });

  it("lê na empresa e com o id da pessoa logada; com falha, lista vazia", async () => {
    const read = vi.fn(async () => [{ id: "question:q1", kind: "question" as const, text: "Beto deixou uma pergunta e está esperando", reason: "pergunta que precisa de você, há 1 dia", ref: "question:q1" }]);
    expect((await loadWaiting(me, new Date(), { read })).map((w) => w.id)).toEqual(["Pergunta"]);
    expect(read).toHaveBeenCalledWith("org-real", me.id);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadWaiting(me, new Date(), { read: () => Promise.reject(new Error("fora do ar")) })).toEqual([]);
    err.mockRestore();
  });
});

describe("Meu plano, do banco", () => {
  it("item gravado pelo plano da manhã, com o motivo da regra", () => {
    expect(planItemView({ id: "due:PLA-7", kind: "task_overdue", text: "PLA-7 passou do prazo", reason: "prazo era 05/11", ref: "linear:PLA-7" })).toEqual({ id: "due:PLA-7", title: "PLA-7 passou do prazo", why: "Prazo era 05/11.", kind: "prazo" });
    expect(planItemView({ id: "fix:f1", kind: "fix_ready", text: "Correção pronta", reason: "", ref: "fix:f1" })).toMatchObject({ kind: "correção", why: "" });
  });

  it("data pedida no link do Slack ou hoje no fuso da pessoa", () => {
    const now = new Date("2026-11-07T02:00:00Z"); // 06/11, 23:00 em Fortaleza
    expect(planDate(undefined, now, "America/Fortaleza")).toBe("2026-11-06");
    expect(planDate("2026-11-05", now, "America/Fortaleza")).toBe("2026-11-05");
    expect(planDate("ontem", now, "America/Fortaleza")).toBe("2026-11-06");
  });

  it("sem plano no banco, null (estado vazio); nunca o da demonstração", async () => {
    const read = vi.fn(async () => null);
    expect(await loadMorningPlan(me, "2026-11-06", { read })).toBeNull();
    expect(read).toHaveBeenCalledWith("org-real", me.id, "2026-11-06");
    expect(await loadMorningPlan(me, "2026-11-06", { read: async () => [{ id: "question:q1", kind: "question", text: "Pergunta", reason: "há 1 dia", ref: "question:q1" }] })).toEqual([{ id: "question:q1", title: "Pergunta", why: "Há 1 dia.", kind: "esperando" }]);
  });
});
