import { describe, expect, it } from "vitest";
import { AGENT_PROFILE_RULES, cleanAgentText, delegatedCiGate, delegatedFixGate } from "./agent-profile.ts";

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

describe("CI do rascunho na delegação", () => {
  const since = new Date("2026-11-09T06:00:00Z");
  const at = (min: number) => new Date(since.getTime() + min * 60_000);
  it("só une com CI verde: o 'testes passaram' do fix.json não basta", () => {
    expect(delegatedCiGate("success", since, at(1))).toEqual({ ok: true });
    expect(delegatedCiGate("failure", since, at(1))).toEqual({ ok: false, reason: "o CI do rascunho falhou" });
    expect(delegatedCiGate("neutral", since, at(1))).toMatchObject({ ok: false });
  });

  it("CI rodando, sem checks ou sem leitura: espera até o prazo e depois fica com a pessoa", () => {
    const wait = AGENT_PROFILE_RULES.delegatedCiWaitMinutes;
    const none = AGENT_PROFILE_RULES.delegatedCiNoChecksMinutes;
    expect(delegatedCiGate("pending", since, at(wait - 1))).toEqual({ wait: true, reason: "o CI do rascunho ainda está rodando" });
    expect(delegatedCiGate("pending", since, at(wait))).toEqual({ ok: false, reason: `o CI do rascunho não terminou em ${wait} min` });
    expect(delegatedCiGate("none", since, at(none - 1))).toMatchObject({ wait: true });
    expect(delegatedCiGate("none", since, at(none))).toEqual({ ok: false, reason: `o rascunho não teve CI em ${none} min` });
    expect(delegatedCiGate("unknown", since, at(0))).toMatchObject({ wait: true });
    expect(delegatedCiGate("unknown", since, at(wait))).toMatchObject({ ok: false });
  });
});
