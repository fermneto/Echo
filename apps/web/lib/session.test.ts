import { afterEach, describe, expect, it, vi } from "vitest";
import { isDemoSession } from "./session";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

describe("sessão de demonstração", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("com DEMO_MODE, a persona escolhida em /entrar não grava nada", () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect(isDemoSession({ id: "rita" })).toBe(true);
    // Quem entrou com o Slack tem o id do banco: grava normalmente.
    expect(isDemoSession({ id: "00000000-0000-4000-8000-000000000107" })).toBe(false);
  });

  it("sem DEMO_MODE, ninguém é sessão de demonstração", () => {
    vi.stubEnv("DEMO_MODE", "false");
    expect(isDemoSession({ id: "rita" })).toBe(false);
  });
});
