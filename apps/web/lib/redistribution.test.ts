import type { PanelPlan } from "@echo/agents/redistribuicao";
import { describe, expect, it } from "vitest";
import { absenceKind, confirmText, itemChip, loadLabel, pendingPlanItem, planView, sinceLabel } from "./redistribution";

const TZ = "America/Fortaleza";
const plan = (over: Partial<PanelPlan> = {}): PanelPlan => ({
  id: "p1",
  trigger: "vacation",
  state: "awaiting_leader",
  title: "Plano para as férias de Bruno (10 a 21/11)",
  absentName: "Bruno",
  createdAt: new Date("2026-11-07T12:00:00Z"),
  items: [
    { id: "i1", kind: "task", label: "ECH-133", title: "Estorno parcial", toId: "c", toName: "Carla", reason: "Atua em pagamentos e tem folga.", state: "proposed", load: { load: 3, limit: 12 } },
    { id: "i2", kind: "task", label: "ECH-137", title: "Texto do recibo", toId: "e", toName: "Eduardo", reason: "Sem área definida, escolhida pela folga.", state: "proposed", load: { load: 2.4, limit: 10.29 } },
    { id: "i3", kind: "review", label: "PR 36", title: "Revisão do PR 36", reason: "Ninguém com folga e sem ausência nos próximos 14 dias para revisar.", state: "unassigned" },
  ],
  ...over,
});

describe("loadLabel", () => {
  it("escreve a carga em pontos, com meio ponto das revisões", () => {
    expect(loadLabel({ load: 3, limit: 8 })).toBe("carga 3 de 8 pts");
    expect(loadLabel({ load: 2.5, limit: 10.29 })).toBe("carga 2,5 de 10,3 pts");
  });
  it("sem carga, sem texto", () => {
    expect(loadLabel(undefined)).toBeUndefined();
    expect(loadLabel({ load: Number.NaN, limit: 8 })).toBeUndefined();
  });
});

describe("planView", () => {
  it("plano esperando: carga só nos itens propostos, e tudo pode ficar de fora", () => {
    const v = planView(plan(), TZ);
    expect(v.items.map((i) => i.load)).toEqual(["carga 3 de 12 pts", "carga 2,4 de 10,3 pts", undefined]);
    expect(v.items.map((i) => i.chip.label)).toEqual(["proposto", "proposto", "sem responsável"]);
    expect(v.items.every((i) => i.excludable)).toBe(true);
    expect(v.receivers).toEqual(["Carla", "Eduardo"]);
    expect(v.outcome).toBeUndefined();
  });

  it("aprovado e em execução: diz o que já mudou e o que falta, sem fingir que terminou", () => {
    const p = plan({
      state: "executing",
      approvedByName: "Marina",
      decidedAt: new Date("2026-11-07T21:40:00Z"),
      items: plan().items.map((i) => (i.id === "i1" ? { ...i, state: "done" as const } : i.id === "i2" ? { ...i, state: "approved" as const } : i)),
    });
    const v = planView(p, TZ);
    expect(v.outcome?.title).toBe("Plano aprovado por Marina em 07/11 18:40. Aplicando.");
    expect(v.outcome?.text).toBe("1 mudança feita; 1 em andamento no Linear e no GitHub; 1 item segue sem responsável. A mudança está na auditoria, em Custo e execuções.");
    expect(v.items.map((i) => i.chip.label)).toEqual(["aplicado", "aplicando", "sem responsável"]);
    expect(v.items.some((i) => i.excludable || i.load)).toBe(false);
  });

  it("concluído com falha e descartado", () => {
    const failed = planView(plan({ state: "done", items: [{ ...plan().items[0]!, state: "failed" }] }), TZ);
    expect(failed.outcome?.title).toBe("Plano aplicado.");
    expect(failed.outcome?.text).toMatch(/^1 item precisa de outra pessoa\./);
    expect(failed.items[0]!.chip).toEqual({ label: "não mudou", tone: "fail" });
    const rejected = planView(plan({ state: "rejected", approvedByName: "Marina" }), TZ);
    expect(rejected.outcome?.title).toBe("Plano descartado por Marina.");
  });

  it("item fora do plano não conta como quem recebe", () => {
    const v = planView(plan({ state: "executing", items: [{ ...plan().items[0]!, state: "excluded" }] }), TZ);
    expect(v.receivers).toEqual([]);
    expect(itemChip("excluded")).toEqual({ label: "fora do plano", tone: "off" });
  });
});

describe("confirmText", () => {
  const items = planView(plan(), TZ).items;
  it("conta só o que muda de mãos e avisa o que segue sem responsável", () => {
    expect(confirmText(items, new Set())).toEqual({
      title: "Aplicar 2 mudanças no Linear e no GitHub?",
      text: "Carla e Eduardo recebem as tarefas e são avisados no Slack. Cada um pode recusar com motivo. 1 item segue sem responsável, com o motivo.",
      changes: 2,
    });
  });
  it("itens deixados de fora saem da conta", () => {
    const r = confirmText(items, new Set(["i2", "i3"]));
    expect(r.title).toBe("Aplicar 1 mudança no Linear e no GitHub?");
    expect(r.text).toBe("Carla recebe as tarefas e é avisado no Slack. Cada um pode recusar com motivo. 2 itens ficam de fora.");
  });
});

describe("datas e tipos", () => {
  const now = new Date("2026-11-07T15:00:00Z");
  it("sinceLabel no fuso de quem lê", () => {
    expect(sinceLabel(new Date("2026-11-07T11:00:00Z"), now, TZ)).toBe("hoje");
    expect(sinceLabel(new Date("2026-11-06T12:00:00Z"), now, TZ)).toBe("ontem");
    expect(sinceLabel(new Date("2026-11-03T12:00:00Z"), now, TZ)).toBe("03/11");
  });
  it("pendingPlanItem", () => {
    expect(pendingPlanItem({ id: "p1", title: "Plano para as férias de Bruno (10 a 21/11)", createdAt: new Date("2026-11-07T11:00:00Z") }, now, TZ)).toEqual({ id: "plano-p1", title: "Plano para as férias de Bruno (10 a 21/11)", since: "hoje" });
  });
  it("absenceKind", () => {
    expect(absenceKind("Férias")).toBe("vacation");
    expect(absenceKind("Licença")).toBe("leave");
    expect(absenceKind("Ausência imprevista")).toBe("unexpected");
    expect(absenceKind("Outro")).toBeNull();
  });
});
