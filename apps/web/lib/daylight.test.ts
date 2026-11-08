import { describe, expect, it } from "vitest";
import { daylight, solarElevation } from "./daylight";

// 7/11, 15:00 UTC: meio-dia em Fortaleza (UTC-3), madrugada em Tóquio.
const AT = new Date("2026-11-07T15:00:00Z");

describe("luz do dia no mapa", () => {
  it("dia pleno onde é meio-dia, noite onde é madrugada", () => {
    expect(daylight(-3.73, -38.53, AT)).toBe(1);
    expect(daylight(35.68, 139.65, AT)).toBe(0);
    expect(solarElevation(-3.73, -38.53, AT)).toBeGreaterThan(60);
  });

  it("no crepúsculo fica entre os dois, sem salto", () => {
    // Ao longo do equador, passando pelo pôr do sol (perto de 45° leste a esta hora), a luz cai aos poucos.
    const samples = Array.from({ length: 81 }, (_, i) => daylight(0, 35 + i * 0.5, AT));
    const between = samples.filter((v) => v > 0.02 && v < 0.98).length;
    expect(between).toBeGreaterThan(8);
    for (let i = 1; i < samples.length; i++) expect(Math.abs(samples[i]! - samples[i - 1]!)).toBeLessThan(0.15);
  });
});
