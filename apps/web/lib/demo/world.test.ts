import { describe, expect, it } from "vitest";
import { DEMO_NOW } from "./personas";
import { WORLD, worldCounts, worldState } from "./world";

const byId = (id: string) => WORLD.find((m) => m.id === id)!;

describe("worldState no instante da demo (06:12 UTC, sexta)", () => {
  it("Américas e Europa dormem: o agente cobre", () => {
    for (const id of ["lucia", "ana", "ines", "jonas", "amara"]) expect(worldState(byId(id), DEMO_NOW)).toBe("twin");
  });

  it("Oriente Médio, Ásia e Oceania estão no expediente", () => {
    for (const id of ["omar", "priya", "wei", "jiwoo", "olivia"]) expect(worldState(byId(id), DEMO_NOW)).toBe("on");
  });

  it("férias valem mais que o expediente", () => {
    expect(worldState(byId("noah"), DEMO_NOW)).toBe("wait");
  });

  it("a contagem soma a demo e o mundo", () => {
    const c = worldCounts(DEMO_NOW);
    expect(c.total).toBe(7 + WORLD.length);
    expect(c.on + c.twin + c.wait).toBe(c.total);
  });
});
