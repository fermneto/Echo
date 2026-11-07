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

  it("aceita ANTHROPIC_API_KEY vazia e recusa chave fora do formato", () => {
    expect(loadConfig("worker", { DATABASE_URL: DB, ANTHROPIC_API_KEY: "" }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(loadConfig("web", { ANTHROPIC_API_KEY: "sk-ant-teste" }).ANTHROPIC_API_KEY).toBe("sk-ant-teste");
    expect(() => loadConfig("reviewer", { DATABASE_URL: DB, ANTHROPIC_API_KEY: "minha-senha" })).toThrow(/ANTHROPIC_API_KEY.*sk-ant-/);
  });

  it("reviewer: IDs da correção opcionais, no formato do Managed Agents, e prazos com padrão", () => {
    const cfg = loadConfig("reviewer", { DATABASE_URL: DB, FIX_AGENT_ID: "", FIX_ENVIRONMENT_ID: "" });
    expect(cfg).toMatchObject({ FIX_AGENT_ID: undefined, FIX_ENVIRONMENT_ID: undefined, FIX_SCAN_MS: 300_000, FIX_TIMEOUT_MS: 1_200_000 });
    expect(loadConfig("reviewer", { DATABASE_URL: DB, FIX_AGENT_ID: "agent_01", FIX_ENVIRONMENT_ID: "env_01" })).toMatchObject({ FIX_AGENT_ID: "agent_01", FIX_ENVIRONMENT_ID: "env_01" });
    expect(() => loadConfig("reviewer", { DATABASE_URL: DB, FIX_AGENT_ID: "abc" })).toThrow(/FIX_AGENT_ID.*agent_/);
  });

  it("PORT da plataforma tem prioridade sobre a porta local", () => {
    expect(listenPort(loadConfig("api", { DATABASE_URL: DB, PORT: "10000" }))).toBe(10000);
    expect(listenPort(loadConfig("api", { DATABASE_URL: DB }))).toBe(3001);
  });
  it("triagem: URL ou host:porta da Render, modelo e tempo com padrão", () => {
    const base = { DATABASE_URL: DB };
    expect(loadConfig("worker", base)).toMatchObject({ SLM_MODEL: "qwen3:4b-instruct", TRIAGE_TIMEOUT_MS: 120_000 });
    expect(loadConfig("worker", base).SLM_OLLAMA_URL).toBeUndefined();
    expect(loadConfig("worker", { ...base, SLM_OLLAMA_URL: "echo-triage-ab12:11434" }).SLM_OLLAMA_URL).toBe("echo-triage-ab12:11434");
    expect(loadConfig("worker", { ...base, SLM_OLLAMA_URL: "http://localhost:11434" }).SLM_OLLAMA_URL).toBe("http://localhost:11434");
    expect(() => loadConfig("worker", { ...base, SLM_OLLAMA_URL: "ftp://x y" })).toThrow(/SLM_OLLAMA_URL/);
  });
});
