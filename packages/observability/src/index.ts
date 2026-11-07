import { pino, type Logger } from "pino";

export type { Logger };

/** Logs estruturados em JSON. Nunca registrar status do Slack, textos de mensagens privadas ou segredos. */
export function createLogger(service: string, level = "info"): Logger {
  return pino({
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["*.token", "*.secret", "*.password", "*.apiKey", "*.authorization", "headers.authorization", "headers.cookie"],
      censor: "[oculto]",
    },
  });
}

/** Uma execução de fluxo. Todo fluxo grava uma linha em `agent_runs`. */
export interface AgentRun {
  flow: string;
  orgId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  durationMs: number;
  tools?: string[];
  /** skipped: o fluxo rodou e decidiu não agir (ex.: sem evento nas últimas 24 h), com o motivo em `error`. */
  result: "ok" | "fallback" | "refused" | "failed" | "skipped";
  error?: string;
}

export interface RunRecorder {
  record(run: AgentRun): Promise<void>;
}

/** Registro em log, usado nos testes e enquanto a gravação no banco não está ligada. */
export class LogRunRecorder implements RunRecorder {
  readonly runs: AgentRun[] = [];
  constructor(private readonly logger?: Logger) {}
  async record(run: AgentRun): Promise<void> {
    this.runs.push(run);
    this.logger?.info({ run }, "agent_run");
  }
}

/** Mede a duração de um fluxo e registra o resultado, inclusive em caso de erro. */
export async function withRun<T>(
  recorder: RunRecorder,
  flow: string,
  fn: () => Promise<T>,
  extra: Omit<AgentRun, "flow" | "durationMs" | "result"> = {},
): Promise<T> {
  const start = performance.now();
  try {
    const value = await fn();
    await recorder.record({ ...extra, flow, durationMs: Math.round(performance.now() - start), result: "ok" });
    return value;
  } catch (err) {
    await recorder.record({
      ...extra,
      flow,
      durationMs: Math.round(performance.now() - start),
      result: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export { initTracing } from "./tracing.ts";
