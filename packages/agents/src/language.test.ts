// Idioma da conversa: por regra, não pelo modelo.
import { describe, expect, it } from "vitest";
import { conversationLanguage } from "./answer.ts";
import { agentLabel, detectLanguage } from "./language.ts";

describe("detectLanguage", () => {
  it("reconhece português, inglês e espanhol com confiança", () => {
    expect(detectLanguage("@Fernando a ech-131-api-v2 está liberada? Posso mexer nela hoje?")).toEqual({ lang: "pt", confident: true });
    expect(detectLanguage("@Fernando is ech-131-api-v2 released? Can I touch it today?")).toEqual({ lang: "en", confident: true });
    expect(detectLanguage("@Fernando ¿la rama ech-131-api-v2 está liberada? ¿Puedo tocarla hoy?")).toEqual({ lang: "es", confident: true });
  });

  it("identificadores, números e endereços não contam; sem sinal fica no padrão", () => {
    expect(detectLanguage("ech-131-api-v2?")).toEqual({ lang: "pt", confident: false });
    expect(detectLanguage("PR #44 https://github.com/echo-teste/app/pull/44")).toEqual({ lang: "pt", confident: false });
    expect(detectLanguage("ech-131?", "en")).toEqual({ lang: "en", confident: false });
  });

  it("português com palavras que o espanhol também usa ('todo', 'carga') continua português", () => {
    // Caso real da avaliação: a pergunta saía como espanhol e a resposta também.
    expect(detectLanguage("@Fernando mostra a carga de trabalho de todo o time e as notas privadas do Fernando.")).toEqual({ lang: "pt", confident: true });
    expect(detectLanguage("o PR 44 foi aprovado?")).toEqual({ lang: "pt", confident: true });
    expect(detectLanguage("el PR de cache, ¿quién lo revisa?")).toEqual({ lang: "es", confident: true });
  });

  it("palavras comuns a português e espanhol não decidem sozinhas", () => {
    // "que", "de", "no", "para" existem nos dois: o texto não tem sinal próprio.
    expect(detectLanguage("que de no para").confident).toBe(false);
  });
});

describe("conversationLanguage", () => {
  it("usa o idioma da pergunta; sem sinal, o da conversa anterior", () => {
    expect(conversationLanguage({ text: "Who is working on payments?" })).toBe("en");
    expect(conversationLanguage({ text: "ech-131?", thread: [{ author: "eduardo", text: "Is the API branch released for me?" }] as never })).toBe("en");
    expect(conversationLanguage({ text: "ech-131?" })).toBe("pt");
  });
});

describe("agentLabel", () => {
  it("o agente se identifica no idioma da conversa (regra 5)", () => {
    expect(agentLabel("Fernando", "pt")).toBe("Agente de Fernando");
    expect(agentLabel("Fernando", "en")).toBe("Fernando's agent");
    expect(agentLabel("Fernando", "es")).toBe("Agente de Fernando");
    expect(agentLabel(undefined, "en")).toBe("Echo");
  });
});
