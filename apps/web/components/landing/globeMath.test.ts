import { describe, expect, it } from "vitest";
import { angleDeg, arcPoint, fibonacciLatLng, rotate, toVec } from "./globeMath";

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("globeMath", () => {
  it("a longitude escolhida fica de frente (z = 1) sem inclinação", () => {
    const [x, y, z] = rotate(toVec(0, -38.5), (-38.5 * Math.PI) / 180, 0);
    close(x, 0);
    close(y, 0);
    close(z, 1);
  });

  it("o lado oposto fica de costas (z < 0)", () => {
    expect(rotate(toVec(0, 141.5), (-38.5 * Math.PI) / 180, 0)[2]).toBeLessThan(0);
  });

  it("inclinar para frente leva o polo norte para quem olha", () => {
    expect(rotate(toVec(90, 0), 0, 0.3)[2]).toBeGreaterThan(0);
  });

  it("distância angular entre Fortaleza e Joanesburgo fica perto de 69°", () => {
    expect(angleDeg(toVec(-3.73, -38.53), toVec(-26.2, 28.05))).toBeGreaterThan(65);
    expect(angleDeg(toVec(-3.73, -38.53), toVec(-26.2, 28.05))).toBeLessThan(72);
  });

  it("o arco começa e termina nos pontos e sobe no meio", () => {
    const a = toVec(-3.73, -38.53);
    const b = toVec(-26.2, 28.05);
    arcPoint(a, b, 0, 0.3).forEach((v, i) => close(v, a[i]!));
    arcPoint(a, b, 1, 0.3).forEach((v, i) => close(v, b[i]!));
    expect(Math.hypot(...arcPoint(a, b, 0.5, 0.3))).toBeCloseTo(1.3, 6);
  });

  it("a espiral cobre a esfera inteira", () => {
    const pts = fibonacciLatLng(1000);
    expect(pts).toHaveLength(1000);
    expect(Math.min(...pts.map((p) => p[0]))).toBeLessThan(-85);
    expect(Math.max(...pts.map((p) => p[0]))).toBeGreaterThan(85);
    for (const [, lng] of pts) expect(Math.abs(lng)).toBeLessThanOrEqual(180);
  });
});
