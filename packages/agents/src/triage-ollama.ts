// Adaptador da triagem para o Ollama (API nativa /api/chat, saída restrita ao esquema JSON por `format`).
// Roda num serviço privado (sem acesso público): a triagem não chama nenhum serviço de fora.
import type { TriageModel } from "./triage.ts";

export interface OllamaTriageOptions {
  /** Endereço do Ollama, ex.: http://localhost:11434 (aceita host:porta, como a Render entrega). */
  baseUrl: string;
  /** Tag do modelo no Ollama, ex.: qwen3:4b-instruct. */
  model: string;
  fetch?: typeof fetch;
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

/** Classificador genérico (triagem, juiz da delegação): pergunta objetiva, saída presa ao esquema JSON. */
export interface OllamaClassifier {
  readonly model: string;
  classify(request: { system: string; user: string; schema: object }, signal: AbortSignal): Promise<{ raw: unknown; inputTokens?: number; outputTokens?: number }>;
}

export function ollamaTriage(opts: OllamaTriageOptions): TriageModel {
  return ollamaClassifier(opts);
}

export function ollamaClassifier(opts: OllamaTriageOptions): OllamaClassifier {
  const doFetch = opts.fetch ?? fetch;
  const url = `${ollamaBaseUrl(opts.baseUrl)}/api/chat`;
  return {
    model: opts.model,
    async classify(request, signal) {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          model: opts.model,
          stream: false,
          format: request.schema,
          // Mantém o modelo carregado entre os PRs da mesma noite.
          keep_alive: "30m",
          options: { temperature: 0, num_ctx: 8192 },
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        }),
      });
      const body = (await res.json().catch(() => ({}))) as OllamaChatResponse;
      if (!res.ok) throw new Error(`ollama ${res.status}: ${body.error ?? "erro"}`);
      const content = body.message?.content ?? "";
      let raw: unknown = null;
      try {
        raw = JSON.parse(content);
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
