import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@echo/db";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const { loadOwnAgent } = await import("./agent-profile-store");

const db = {} as Database;
const me = { id: "00000000-0000-4000-8000-000000000201", orgId: "00000000-0000-4000-8000-000000000200" };
const profile = { style: "curto e direto", delegation: "pode unir correções pequenas", delegationUpdatedAt: new Date("2026-11-07T12:00:00Z") };
const decision = { fixId: "f1", repository: "acme/api", prNumber: 41, draftPrNumber: 42, outcome: "com_voce" as const, state: "ready", note: "", at: new Date("2026-11-08T03:00:00Z") };
const fail = () => Promise.reject(new Error('column "ci_wait_since" does not exist'));

describe("loadOwnAgent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lê o texto e as decisões do banco", async () => {
    const r = await loadOwnAgent(me, db, { read: { readAgentProfile: async () => profile, readAgentDecisions: async () => [decision] } });
    expect(r).toEqual({
      status: "ok",
      agent: { style: profile.style, delegation: profile.delegation, delegationAt: profile.delegationUpdatedAt, decisions: [{ fixId: "f1", repository: "acme/api", prNumber: 41, draftPrNumber: 42, outcome: "com_voce", state: "ready", note: "", atIso: "2026-11-08T03:00:00.000Z" }], demo: false },
    });
  });

  it("decisões que falham não derrubam o formulário: o texto salvo continua aparecendo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadOwnAgent(me, db, { read: { readAgentProfile: async () => profile, readAgentDecisions: fail } });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.agent.decisions).toBeNull();
    expect(r.agent.style).toBe(profile.style);
    expect(r.agent.delegation).toBe(profile.delegation);
  });

  it("texto que falha deixa o bloco indisponível, nunca um formulário vazio que apagaria o salvo", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await loadOwnAgent(me, db, { read: { readAgentProfile: fail, readAgentDecisions: async () => [decision] } });
    expect(r).toEqual({ status: "indisponivel" });
  });

  it("empresa conectada sem banco: vazio, sem as decisões de exemplo", async () => {
    expect(await loadOwnAgent(me, null)).toEqual({ status: "ok", agent: { style: "", delegation: "", delegationAt: null, decisions: [], demo: false } });
  });
});
