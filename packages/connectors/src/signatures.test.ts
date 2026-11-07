import { describe, expect, it } from "vitest";
import { TokenCipher } from "./crypto.ts";
import { sign, verifyGithub, verifyHr, verifyLinear, verifySlack } from "./signatures.ts";

const S = "segredo-de-teste";
const NOW = Date.parse("2026-11-07T13:00:00Z");
const nowS = Math.floor(NOW / 1000);

describe("verifyGithub", () => {
  const body = '{"zen":"ok"}';
  it("aceita assinatura correta", () => expect(verifyGithub(S, body, sign.github(S, body))).toEqual({ ok: true }));
  it("recusa assinatura de outro segredo ou corpo alterado", () => {
    expect(verifyGithub(S, body, sign.github("outro", body)).ok).toBe(false);
    expect(verifyGithub(S, body + " ", sign.github(S, body)).ok).toBe(false);
  });
  it("recusa sem cabeçalho", () => expect(verifyGithub(S, body, {})).toEqual({ ok: false, reason: "assinatura ausente" }));
});

describe("verifySlack", () => {
  const body = "token=x&payload=%7B%7D";
  it("aceita dentro da janela", () => expect(verifySlack(S, body, sign.slack(S, body, nowS), NOW).ok).toBe(true));
  it("recusa reenvio antigo (mais de 5 min)", () => {
    expect(verifySlack(S, body, sign.slack(S, body, nowS - 301), NOW)).toEqual({ ok: false, reason: "timestamp fora da janela" });
  });
  it("recusa assinatura inválida", () => expect(verifySlack(S, body, sign.slack("x", body, nowS), NOW).ok).toBe(false));
});

describe("verifyLinear", () => {
  it("aceita corpo assinado e recente", () => {
    const body = JSON.stringify({ webhookTimestamp: NOW - 5_000 });
    expect(verifyLinear(S, body, sign.linear(S, body), NOW).ok).toBe(true);
  });
  it("recusa timestamp velho", () => {
    const body = JSON.stringify({ webhookTimestamp: NOW - 120_000 });
    expect(verifyLinear(S, body, sign.linear(S, body), NOW)).toEqual({ ok: false, reason: "timestamp fora da janela" });
  });
});

describe("verifyHr", () => {
  const body = '{"id":"evento-1"}';
  it("aceita e recusa conforme a janela de 5 minutos", () => {
    expect(verifyHr(S, body, sign.hr(S, body, nowS), NOW).ok).toBe(true);
    expect(verifyHr(S, body, sign.hr(S, body, nowS - 400), NOW).ok).toBe(false);
  });
});

describe("TokenCipher", () => {
  const key = "a".repeat(64);
  it("cifra e decifra, com IV diferente a cada vez", () => {
    const c = new TokenCipher(key);
    const a = c.encrypt("xoxb-token");
    expect(a).not.toContain("xoxb");
    expect(a).not.toBe(c.encrypt("xoxb-token"));
    expect(c.decrypt(a)).toBe("xoxb-token");
  });
  it("falha com chave errada ou texto adulterado", () => {
    const sealed = new TokenCipher(key).encrypt("segredo");
    expect(() => new TokenCipher("b".repeat(64)).decrypt(sealed)).toThrow();
    // Troca o último caractere por outro sempre diferente, para o texto mudar de verdade.
    const last = sealed.at(-1)!;
    const tampered = sealed.slice(0, -1) + (last === "0" ? "1" : "0");
    expect(() => new TokenCipher(key).decrypt(tampered)).toThrow();
  });
  it("recusa chave em formato inválido", () => expect(() => new TokenCipher("curta")).toThrow(/64 caracteres/));
});
