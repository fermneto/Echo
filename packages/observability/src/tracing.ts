import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

export interface TracingOptions {
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  baseUrl?: string | undefined;
}

let provider: NodeTracerProvider | undefined;

/**
 * Liga o Langfuse (SDK v6) quando as chaves existem. Sem chaves, não faz nada:
 * `agent_runs` continua sendo o registro obrigatório de toda execução.
 * Retorna uma função para enviar os spans pendentes antes de encerrar.
 */
export function initTracing(opts: TracingOptions): () => Promise<void> {
  if (!opts.publicKey || !opts.secretKey) return async () => {};
  if (provider) return () => provider!.forceFlush();
  const processor = new LangfuseSpanProcessor({
    publicKey: opts.publicKey,
    secretKey: opts.secretKey,
    ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
  });
  provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();
  return () => provider!.forceFlush();
}
