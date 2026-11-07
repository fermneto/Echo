import type { Contribution, WeeklyMetrics } from "@echo/domain";
import { describe, expect, it } from "vitest";
import { helpTotal, summaryLine } from "./demo/reports";
import { canComment, helpRef, helpSources, latestPerPerson, refLabel, reportStatus, weekLabel, weekReportFrom } from "./reports";

const CARLA = "p-carla";
const period = { from: new Date("2026-11-02T03:00:00Z"), to: new Date("2026-11-07T03:00:00Z") };
const names = new Map([
  ["p-bruno", "Bruno"],
  ["p-fernando", "Fernando"],
]);
const c = (over: Partial<Contribution>): Contribution => ({ helperId: CARLA, helpedId: "p-bruno", kind: "reaction", confirmed: true, occurredAt: new Date("2026-11-04T12:00:00Z"), ...over });

describe("relatório no painel", () => {
  it("semana: mesmo mês e virada de mês", () => {
    expect(weekLabel("2026-11-02", "2026-11-06")).toBe("02 a 06/11");
    expect(weekLabel("2026-10-30", "2026-11-03")).toBe("30/10 a 03/11");
  });

  it("referências legíveis", () => {
    expect(refLabel("linear:ECH-133")).toBe("ECH-133");
    expect(refLabel("github:pr/41")).toBe("PR 41");
  });

  it("ajudas: só as que contam na regra, cada uma com fonte e sem texto de conversa", () => {
    const helps = helpSources(
      [
        c({ kind: "review_change", helpedId: "p-fernando", deliveryRef: "github:pr/41", occurredAt: new Date("2026-11-05T12:00:00Z") }),
        c({ deliveryRef: "linear:ECH-133" }),
        c({ confirmed: false }),
        c({ helperId: "p-bruno", helpedId: CARLA }),
        c({ helpedId: CARLA }),
        c({ occurredAt: new Date("2026-11-08T12:00:00Z") }),
      ],
      CARLA,
      period,
      names,
    );
    expect(helps).toEqual([
      { to: "Bruno", what: "ajuda agradecida em ECH-133", source: "reação de obrigado no Slack" },
      { to: "Fernando", what: "revisão seguida de mudança no código em PR 41", source: "GitHub" },
    ]);
  });

  it("os números do cartão são os das métricas, mesmo se a lista de ajudas vier diferente", () => {
    const metrics: WeeklyMetrics = { deliveries: 0, commits: 2, reviews: 3, helps: 5, delays: [{ taskKey: "ECH-140", cause: "PR aguardando revisão" }], deliveryRefs: [], helped: [] };
    const r = weekReportFrom({ personId: CARLA, period: { from: "2026-11-02", to: "2026-11-06" }, metrics, helps: [] });
    expect(helpTotal(r)).toBe(5);
    expect(r.delays).toEqual(["ECH-140 (PR aguardando revisão)"]);
    expect(summaryLine("Carla", r)).toBe("Carla registrou na semana 0 entregas, 2 commits e 3 revisões, e 5 ajudas confirmadas a colegas.");
  });

  it("estado: prazo de envio a partir do aviso, e enviado não aceita observação", () => {
    const tz = "America/Fortaleza";
    expect(reportStatus("awaiting_owner", { noticeAt: new Date("2026-11-06T21:00:00Z"), timeZone: tz }).label).toBe("Aguardando a sua conferência · segue ao RH em 09/11");
    expect(reportStatus("commented", { noticeAt: new Date("2026-11-06T21:00:00Z"), timeZone: tz }).tone).toBe("on");
    expect(reportStatus("sent", { sentAt: new Date("2026-11-09T21:00:00Z"), timeZone: tz }).label).toBe("Enviado ao RH em 09/11");
    expect(reportStatus("sent_without_notice", { timeZone: tz }).label).toMatch(/sem aviso/);
    expect(canComment("commented")).toBe(true);
    expect(canComment("sent")).toBe(false);
  });

  it("'Em quê' vira referência aceita pelo fluxo, ou é recusado", () => {
    expect(helpRef("")).toEqual({ ok: true });
    expect(helpRef(" ech-128 ")).toEqual({ ok: true, ref: "linear:ECH-128" });
    expect(helpRef("PR 31")).toEqual({ ok: true, ref: "github:pr/31" });
    expect(helpRef("#31")).toEqual({ ok: true, ref: "github:pr/31" });
    expect(helpRef("github:pr/7")).toEqual({ ok: true, ref: "github:pr/7" });
    expect(helpRef("me ajudou muito")).toEqual({ ok: false });
  });

  it("RH: um relatório por pessoa, o mais recente", () => {
    const out = latestPerPerson([
      { personId: "a", week: "2026-W44" },
      { personId: "a", week: "2026-W45" },
      { personId: "b", week: "2026-W44" },
    ]);
    expect(out).toEqual([
      { personId: "a", week: "2026-W45" },
      { personId: "b", week: "2026-W44" },
    ]);
  });
});
