import { describe, expect, it } from "vitest";
import { demoDecisions, parseProfile } from "./agent-profile";
import { planFor } from "./plan";

describe("Seu agente na demonstração", () => {
  it("cookie estranho vira perfil vazio", () => {
    expect(parseProfile(undefined)).toEqual({ style: "", delegation: "", delegationAtIso: null });
    expect(parseProfile("{quebrado")).toEqual({ style: "", delegation: "", delegationAtIso: null });
    expect(parseProfile(JSON.stringify({ style: "curto", delegation: 3 }))).toEqual({ style: "curto", delegation: "", delegationAtIso: null });
  });

  it("a correção que ficou com a pessoa aparece no plano com o mesmo motivo", () => {
    for (const id of ["fernando", "eduardo"]) {
      const kept = demoDecisions(id).find((d) => d.outcome === "com_voce" && d.state === "ready")!;
      const item = planFor(id).find((it) => it.id === `pr-${kept.prNumber}`)!;
      expect(item.why).toContain(kept.note);
    }
    expect(demoDecisions("rita")).toEqual([]);
  });
});
