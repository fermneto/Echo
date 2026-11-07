import { defaultSpec } from "@echo/artifacts";
import { describe, expect, it } from "vitest";
import { factsFromNote } from "./day-summary";

describe("factsFromNote", () => {
  it("sem resumo gravado, os fatos saem da nota e o layout é o padrão", () => {
    const day = factsFromNote({ date: "2026-11-06", state: "draft", sections: { stoppedAt: ["ECH-128, PR 44 aberto."], blocked: ["PR 44 aguarda revisão."], released: [], reserved: ["`ech-128` (até a revisão)"] } }, "Fernando");
    expect(day.facts.map((f) => f.id)).toEqual(["parou:0", "travou:0", "reservado:`ech-128` (até a revisão)"]);
    expect(defaultSpec(day).blocks.map((b) => b.component)).toEqual(["destaque", "lista_pendencias", "quadro_liberado_reservado"]);
  });
});
