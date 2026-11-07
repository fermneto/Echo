import { describe, expect, it } from "vitest";
import { ConfigError, langfuseEnabled, listenPort, loadConfig } from "./index.ts";

const DB = "postgres://echo:echo@localhost:5433/echo";

describe("loadConfig", () => {
  it("aceita uma configuração mínima válida e aplica padrões", () => {
    const cfg = loadConfig("api", { DATABASE_URL: DB });
    expect(cfg.API_PORT).toBe(3001);
    expect(cfg.LOG_LEVEL).toBe("info");
    expect(cfg.DEMO_MODE).toBe(false);
    expect(cfg.NODE_ENV).toBe("development");
  });

  it("falha com mensagem clara quando falta DATABASE_URL", () => {
    try {
      loadConfig("worker", {});
      expect.unreachable();
    } catch (e) {
      const err = e as ConfigError;
      expect(err).toBeInstanceOf(ConfigError);
      expect(err.service).toBe("worker");
      expect(err.message).toContain("DATABASE_URL");
      expect(err.message).toContain(".env.example");
    }
  });

  it("lista todas as variáveis inválidas de uma vez", () => {
    try {
      loadConfig("api", { DATABASE_URL: "mysql://x", API_PORT: "abc", LOG_LEVEL: "verbose" });
      expect.unreachable();
    } catch (e) {
      const err = e as ConfigError;
      expect(err.issues).toHaveLength(3);
      expect(err.message).toMatch(/DATABASE_URL.*postgres/);
      expect(err.message).toContain("API_PORT");
      expect(err.message).toContain("LOG_LEVEL");
    }
  });

  it("interpreta DEMO_MODE como booleano e recusa valores ambíguos", () => {
    expect(loadConfig("web", { DEMO_MODE: "true" }).DEMO_MODE).toBe(true);
    expect(loadConfig("web", { DEMO_MODE: "0" }).DEMO_MODE).toBe(false);
    expect(() => loadConfig("web", { DEMO_MODE: "talvez" })).toThrow(/DEMO_MODE/);
  });

  it("trata Langfuse vazio como desligado e valida a URL", () => {
    const cfg = loadConfig("reviewer", { DATABASE_URL: DB, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "" });
    expect(langfuseEnabled(cfg)).toBe(false);
    expect(langfuseEnabled(loadConfig("reviewer", { DATABASE_URL: DB, LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }))).toBe(true);
    expect(() => loadConfig("reviewer", { DATABASE_URL: DB, LANGFUSE_BASE_URL: "não-é-url" })).toThrow(/LANGFUSE_BASE_URL/);
  });

  it("PORT da plataforma tem prioridade sobre a porta local", () => {
    expect(listenPort(loadConfig("api", { DATABASE_URL: DB, PORT: "10000" }))).toBe(10000);
    expect(listenPort(loadConfig("api", { DATABASE_URL: DB }))).toBe(3001);
  });
});
