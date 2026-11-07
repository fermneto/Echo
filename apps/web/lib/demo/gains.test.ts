import { describe, expect, it } from "vitest";
import { beforeAfter, gains, median, PERIOD } from "./gains";

describe("ganhos", () => {
  it("mediana de lista par, ímpar e vazia", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("os números saem dos registros por regra", () => {
    const g = Object.fromEntries(gains(PERIOD, 15).map((x) => [x.label, x]));
    const waited = PERIOD.waitAvoidedHours.reduce((s, v) => s + v, 0);
    expect(g["Espera evitada"]!.value).toBe(`${waited.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`);
    expect(g["Espera evitada"]!.kind).toBe("estimativa");
    expect(g["Resolveram a dúvida"]!.value).toBe("89%");
    expect(g["Correções aproveitadas"]!.value).toBe("67%");
    expect(g["Custo"]!.value).toBe("US$ 15,00");
  });

  it("só totais da empresa: nenhuma métrica cita uma pessoa", () => {
    const text = gains().map((g) => `${g.label} ${g.value} ${g.detail}`).join(" ");
    for (const name of ["Fernando", "Eduardo", "Yan", "Carla", "Bruno", "Marina"]) expect(text).not.toContain(name);
  });

  it("o depois é menor que o antes na demo", () => {
    for (const b of beforeAfter()) expect(b.after).toBeLessThan(b.before);
  });
});
