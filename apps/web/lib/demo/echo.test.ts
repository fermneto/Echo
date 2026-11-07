import { describe, expect, it } from "vitest";
import { askEchoDemo, ECHO_SUGGESTIONS } from "./echo";
import { notesWith, TIMEOUT_NOTE } from "./notes";
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
    expect(r.text).toContain("5 segundos");
    expect(r.sources[0]?.label).toBe('nota "Tempo limite nos pagamentos", versão 1');
  });

  it("a correção numa nota muda a resposta e a fonte cita a versão nova", () => {
    const notes = notesWith({ [TIMEOUT_NOTE]: [{ body: "Chamadas ao provedor usam tempo limite de 8 segundos, com uma nova tentativa.", by: "Fernando", at: "06/11" }] });
    const r = askEchoDemo("alguém sabe de pagamentos?", TEAM, notes);
    expect(r.text).toContain("8 segundos");
    expect(r.text).not.toContain("5 segundos");
    expect(r.sources[0]?.label).toBe('nota "Tempo limite nos pagamentos", versão 2, corrigida por Fernando');
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

describe("isAvailabilityQuestion", () => {
  it("reconhece perguntas sobre quem está trabalhando", async () => {
    const { isAvailabilityQuestion } = await import("./echo");
    expect(isAvailabilityQuestion("Quem está no expediente agora?")).toBe(true);
    expect(isAvailabilityQuestion("quantas pessoas estão disponíveis?")).toBe(true);
    expect(isAvailabilityQuestion("posso seguir com a ech-131?")).toBe(false);
  });
});
