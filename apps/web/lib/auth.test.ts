import { describe, expect, it } from "vitest";
import { newLoginAttempt, readLoginAttempt, readSession, SESSION_TTL_S, signSession } from "./auth.ts";

const SECRET = "s".repeat(64);
const NOW = 1_762_527_600;
const s = { orgId: "o1", personId: "p1", role: "leader" as const };

describe("sessão do painel", () => {
  it("lê a sessão assinada dentro das 12 horas e recusa depois", () => {
    const t = signSession(SECRET, s, NOW);
    expect(readSession(SECRET, t, NOW + 60)).toEqual({ ...s, exp: NOW + SESSION_TTL_S });
    expect(readSession(SECRET, t, NOW + SESSION_TTL_S + 1)).toBeNull();
  });

  it("recusa cookie adulterado, de outro segredo ou malformado", () => {
    const t = signSession(SECRET, s, NOW);
    const [data] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...s, role: "hr", exp: NOW + 999 })).toString("base64url");
    expect(readSession(SECRET, `${forged}.${t.split(".")[1]}`, NOW)).toBeNull();
    expect(readSession("x".repeat(64), t, NOW)).toBeNull();
    expect(readSession(SECRET, data, NOW)).toBeNull();
    expect(readSession(SECRET, undefined, NOW)).toBeNull();
  });

  it("tentativa de login guarda state e nonce por 10 minutos", () => {
    const a = newLoginAttempt(SECRET, NOW);
    expect(readLoginAttempt(SECRET, a.cookie, NOW + 300)).toMatchObject({ state: a.state, nonce: a.nonce });
    expect(readLoginAttempt(SECRET, a.cookie, NOW + 601)).toBeNull();
    expect(newLoginAttempt(SECRET, NOW).state).not.toBe(a.state);
  });
});
