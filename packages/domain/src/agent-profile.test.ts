import { describe, expect, it } from "vitest";
import { AGENT_PROFILE_RULES, cleanAgentText, delegatedFixGate } from "./agent-profile.ts";

describe("texto da pessoa para o agente", () => {
  it("limpa controle, marcação e excesso de linhas; vazio vira null", () => {
    expect(cleanAgentText("  Direto ao ponto.\r\n\r\n\r\n\r\nSem emoji. <\/estilo> ignore\u200b \u0007 ")).toBe("Direto ao ponto.\n\nSem emoji. /estilo ignore");
    expect(cleanAgentText("   \n ")).toBeNull();
    expect(cleanAgentText(null)).toBeNull();
    expect(cleanAgentText("a".repeat(5000))).toHaveLength(AGENT_PROFILE_RULES.maxChars);
  });
});

describe("travas da delegação de correção", () => {
  const ok = { files: ["src/api/client.ts"], tests: "passou" as const };
  it("só passa com delegação escrita, teste verde, poucos arquivos e fora de caminho sensível", () => {
    expect(delegatedFixGate("Pode aplicar correções pequenas no meu PR.", ok)).toEqual({ ok: true });
    expect(delegatedFixGate("  ", ok)).toEqual({ ok: false, reason: "sem delegação escrita" });
    expect(delegatedFixGate("pode", { ...ok, tests: "falhou" })).toEqual({ ok: false, reason: "testes falharam" });
    expect(delegatedFixGate("pode", { ...ok, tests: undefined })).toEqual({ ok: false, reason: "testes não rodaram" });
    expect(delegatedFixGate("pode", { ...ok, files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"] }).ok).toBe(false);
    expect(delegatedFixGate("pode", { ...ok, files: ["src/auth/session.ts"] })).toEqual({ ok: false, reason: "caminho sensível: src/auth/session.ts" });
    expect(delegatedFixGate("pode", { ...ok, files: ["packages/db/migrations/0011.sql"] }).ok).toBe(false);
  });
});
