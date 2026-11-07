import { z } from "zod";

/** Erro de configuração: a mensagem lista cada variável inválida, para falhar cedo e claro. */
export class ConfigError extends Error {
  override name = "ConfigError";
  constructor(
    readonly service: string,
    readonly issues: readonly string[],
  ) {
    super(`Configuração inválida em "${service}":\n${issues.map((i) => `  - ${i}`).join("\n")}\nConfira o .env (modelo em .env.example).`);
  }
}

const bool = z.stringbool({ truthy: ["true", "1", "yes"], falsy: ["false", "0", "no", ""] });
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v));
const port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

/** Variáveis comuns a todos os serviços. */
export const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DEMO_MODE: bool.default(false),
  LANGFUSE_PUBLIC_KEY: optionalString,
  LANGFUSE_SECRET_KEY: optionalString,
  LANGFUSE_BASE_URL: optionalString.pipe(z.url().optional()),
});

const database = {
  DATABASE_URL: z
    .string({ error: "obrigatória (ex.: postgres://echo:echo@localhost:5433/echo)" })
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "precisa começar com postgres:// ou postgresql://"),
};

// Chave da organização na Anthropic (nunca o login do claude.ai). Opcional: sem ela, os fluxos usam a resposta por regra.
const anthropic = {
  ANTHROPIC_API_KEY: optionalString.pipe(z.string().startsWith("sk-ant-", "precisa começar com sk-ant-").optional()),
};

export const apiSchema = baseSchema.extend({
  ...database,
  // Segredos dos webhooks. Sem eles, a rota responde 503 em vez de aceitar aviso sem assinatura.
  GITHUB_WEBHOOK_SECRET: optionalString,
  SLACK_SIGNING_SECRET: optionalString,
  LINEAR_WEBHOOK_SECRET: optionalString,
  // A Render define PORT; localmente usamos API_PORT.
  PORT: port(3001).optional(),
  API_PORT: port(3001),
});

export const webSchema = baseSchema.extend({
  ...anthropic,
  PORT: port(3000).optional(),
  WEB_PORT: port(3000),
});

export const workerSchema = baseSchema.extend({
  ...database,
  ...anthropic,
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  // Endereço do painel, para o botão "Editar no painel" da nota do dia.
  WEB_URL: z.url().default("http://localhost:3000"),
  // Intervalo da agenda do fim do expediente (nota do dia).
  END_OF_DAY_SCAN_MS: z.coerce.number().int().min(10_000).default(300_000),
  // Hora UTC em que o lote da revisão noturna é criado, uma vez por noite por empresa.
  NIGHT_REVIEW_UTC_HOUR: z.coerce.number().int().min(0).max(23).default(5),
});

export const reviewerSchema = baseSchema.extend({
  ...database,
  ...anthropic,
  // Agente e ambiente da correção no Managed Agents, criados uma vez com `pnpm --filter @echo/reviewer provision`.
  // Sem eles, não há correção.
  FIX_AGENT_ID: optionalString.pipe(z.string().startsWith("agent_", "precisa começar com agent_").optional()),
  FIX_ENVIRONMENT_ID: optionalString.pipe(z.string().startsWith("env_", "precisa começar com env_").optional()),
  // Intervalo da busca por revisões a corrigir e por rascunhos prontos.
  FIX_SCAN_MS: z.coerce.number().int().min(10_000).default(300_000),
  // Tempo máximo de uma correção no ambiente isolado.
  FIX_TIMEOUT_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(1_200_000),
});

export const schemas = { api: apiSchema, web: webSchema, worker: workerSchema, reviewer: reviewerSchema } as const;
export type ServiceName = keyof typeof schemas;
export type ServiceConfig<S extends ServiceName> = z.output<(typeof schemas)[S]>;

type Env = Record<string, string | undefined>;

/** Valida as variáveis de um serviço. Lança ConfigError com todas as falhas de uma vez. */
export function loadConfig<S extends ServiceName>(service: S, env: Env = process.env): ServiceConfig<S> {
  const result = schemas[service].safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
    throw new ConfigError(service, issues);
  }
  return result.data as ServiceConfig<S>;
}

/** Porta efetiva: PORT (plataforma) tem prioridade sobre a porta local. */
export function listenPort(cfg: { PORT?: number | undefined; API_PORT?: number; WEB_PORT?: number }): number {
  return cfg.PORT ?? cfg.API_PORT ?? cfg.WEB_PORT ?? 3000;
}

export function langfuseEnabled(cfg: z.output<typeof baseSchema>): boolean {
  return Boolean(cfg.LANGFUSE_PUBLIC_KEY && cfg.LANGFUSE_SECRET_KEY);
}
