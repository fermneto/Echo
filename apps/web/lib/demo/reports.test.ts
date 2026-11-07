import { describe, expect, it } from "vitest";
import { reportFor, summaryLine } from "./reports";

describe("relatório semanal", () => {
  it("Carla: poucos commits, 0 entregas e 5 ajudas, cada uma com fonte", () => {
    const r = reportFor("carla");
    expect(r.deliveries).toBe(0);
    expect(r.helps).toHaveLength(5);
    for (const h of r.helps) expect(h.source).not.toBe("");
  });
  it("o resumo sai dos números, sem texto da pessoa", () => {
    expect(summaryLine("Carla", reportFor("carla"))).toBe("Carla registrou na semana 0 entregas, 2 commits e 3 revisões, e 5 ajudas confirmadas a colegas.");
  });
  it("quem não tem relatório recebe zeros, nunca números inventados", () => {
    const r = reportFor("ninguem");
    expect([r.deliveries, r.commits, r.reviews, r.helps.length]).toEqual([0, 0, 0, 0]);
  });
});
