import { describe, expect, it } from "vitest";
import { askEchoDemo, ECHO_SUGGESTIONS } from "./echo";
import { TEAM } from "./team";

describe("askEchoDemo", () => {
  it("conta quem está no expediente a partir da equipe, com fonte", () => {
    const r = askEchoDemo("Quem está no expediente agora?", TEAM);
    const on = TEAM.filter((p) => p.availability.kind === "working").length;
    expect(r.text).toContain(`Agora ${on} pessoas`);
    expect(r.sources[0]?.label).toBe("expedientes e ausências cadastrados");
    expect(r.agentName).toBe("Echo");
  });

  it("quem sabe de pagamentos indica com evidência, sem avisar ninguém", () => {
    const r = askEchoDemo("alguém sabe de pagamentos?", TEAM);
    expect(r.text).toContain("Carla");
    expect(r.sources).toHaveLength(1);
  });

  it("tema sem evidência não sugere nomes", () => {
    const r = askEchoDemo("quem sabe de Kubernetes?", TEAM);
    expect(r.text).toBe("Ninguém tem registro nesse tema.");
    expect(r.sources).toEqual([]);
  });

  it("toda sugestão tem resposta com fonte", () => {
    for (const q of ECHO_SUGGESTIONS) expect(askEchoDemo(q, TEAM).sources.length).toBeGreaterThan(0);
  });
});
