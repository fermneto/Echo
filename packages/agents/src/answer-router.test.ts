// Roteador da resposta montado pelo ambiente: SSLM desligado por padrão; só liga com um modelo explícito.
import { describe, expect, it } from "vitest";
import { answerRouter } from "./server.ts";

describe("roteador da resposta pelo ambiente", () => {
  const ollama = { SLM_OLLAMA_URL: "echo-triage-ab12:11434" };

  it("por padrão, só a regra: SSLM_MODEL vazio desliga e não herda o SLM_MODEL da triagem", () => {
    expect(answerRouter({ ...ollama })).toEqual({ sslm: null });
    expect(answerRouter({ ...ollama, SSLM_MODEL: "" })).toEqual({ sslm: null });
    expect(answerRouter({ ...ollama, SSLM_MODEL: "  " })).toEqual({ sslm: null });
    expect(answerRouter({ ...ollama, SLM_MODEL: "qwen3:4b-instruct" })).toEqual({ sslm: null });
    expect(answerRouter({ ...ollama, SLM_MODEL: "qwen3:1.7b", SSLM_MODEL: "" })).toEqual({ sslm: null });
  });

  it("com um modelo explícito e o Ollama, o SSLM liga com esse modelo", () => {
    expect(answerRouter({ ...ollama, SSLM_MODEL: "qwen3:0.6b" })?.sslm?.model).toBe("qwen3:0.6b");
    expect(answerRouter({ ...ollama, SLM_MODEL: "qwen3:4b-instruct", SSLM_MODEL: "qwen3:1.7b" })?.sslm?.model).toBe("qwen3:1.7b");
    expect(answerRouter({ ...ollama, SSLM_TIMEOUT_MS: "5000" })?.timeoutMs).toBe(5000);
  });

  it("SSLM_MODEL=off ou sem Ollama: só a regra, e a dúvida vai ao Sonnet; ANSWER_ROUTER=false desliga tudo", () => {
    expect(answerRouter({ ...ollama, SSLM_MODEL: "off" })).toEqual({ sslm: null });
    expect(answerRouter({ ...ollama, SSLM_MODEL: "OFF" })).toEqual({ sslm: null });
    expect(answerRouter({ SSLM_MODEL: "qwen3:4b-instruct" })).toEqual({ sslm: null });
    expect(answerRouter({ ...ollama, ANSWER_ROUTER: "false" })).toBeUndefined();
  });
});
