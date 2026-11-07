// Cliente do Ollama para os fluxos com modelo aberto pequeno (triagem da revisão noturna, resumo do dia).
// API nativa /api/chat, saída restrita a um esquema JSON por `format`, temperatura zero.
// Roda num serviço privado (sem acesso público): esses fluxos não chamam nenhum serviço de fora.
import type { TriageModel } from "./triage.ts";

export interface OllamaOptions {
  /** Endereço do Ollama, ex.: http://localhost:11434 (aceita host:porta, como a Render entrega). */
  baseUrl: string;
  /** Tag do modelo no Ollama, ex.: qwen3:4b-instruct. */
  model: string;
  fetch?: typeof fetch;
}

/** Chamada com saída JSON restrita: devolve o JSON lido (ou null) e os tokens que o servidor informa. */
export interface JsonModel {
  readonly model: string;
  /** `format: "json"`: JSON livre (o esquema vai só no texto do pedido); padrão: saída restrita ao esquema. */
  json(request: { system: string; user: string; schema: object; format?: "schema" | "json"; maxTokens?: number }, signal: AbortSignal): Promise<{ raw: unknown; inputTokens?: number; outputTokens?: number }>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export function ollamaBaseUrl(value: string): string {
  const v = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(v) ? v : `http://${v}`;
}

export function ollamaJson(opts: OllamaOptions): JsonModel {
  const doFetch = opts.fetch ?? fetch;
  const url = `${ollamaBaseUrl(opts.baseUrl)}/api/chat`;
  return {
    model: opts.model,
    async json(request, signal) {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          model: opts.model,
          stream: false,
          format: request.format === "json" ? "json" : request.schema,
          // Mantém o modelo carregado entre as chamadas seguidas (PRs da noite, notas do fim do expediente).
          keep_alive: "30m",
          // Teto de saída: modelo pequeno às vezes entra em repetição dentro do JSON.
          options: { temperature: 0, num_ctx: 8192, num_predict: request.maxTokens ?? 512 },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as OllamaChatResponse;
      if (!res.ok) throw new Error(`ollama ${res.status}: ${body.error ?? "erro"}`);
      let raw: unknown = null;
      try {
        raw = JSON.parse(body.message?.content ?? "");
      } catch {
        raw = null;
      }
      return {
        raw,
        ...(typeof body.prompt_eval_count === "number" ? { inputTokens: body.prompt_eval_count } : {}),
        ...(typeof body.eval_count === "number" ? { outputTokens: body.eval_count } : {}),
      };
    },
  };
}

/** Triagem da revisão noturna sobre o cliente do Ollama. */
export function ollamaTriage(opts: OllamaOptions): TriageModel {
  const m = ollamaJson(opts);
  return { model: m.model, classify: (request, signal) => m.json(request, signal) };
}
