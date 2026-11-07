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
  /** Chave das credenciais guardadas (openssl rand -hex 32), igual em web, api e worker. */
  ENCRYPTION_KEY: optionalString.pipe(z.string().regex(/^[0-9a-f]{64}$/i, "precisa ter 64 caracteres hex (openssl rand -hex 32)").optional()),
  // A Render define PORT; localmente usamos API_PORT.
  PORT: port(3001).optional(),
  API_PORT: port(3001),
});

export const webSchema = baseSchema.extend({
  ...anthropic,
  PORT: port(3000).optional(),
  WEB_PORT: port(3000),
  /** Banco: necessário para o login com o Slack (sem ele, só o login por persona da demo). */
  DATABASE_URL: optionalString,
  /** Assina o cookie de sessão. Gerado pelo Blueprint; local: openssl rand -hex 32. */
  SESSION_SECRET: optionalString.pipe(z.string().min(32, "precisa ter pelo menos 32 caracteres").optional()),
  /** App do Slack: login no painel ("Sign in with Slack"). */
  SLACK_CLIENT_ID: optionalString,
  SLACK_CLIENT_SECRET: optionalString,
  /** Endereço público do painel (o retorno do login é PANEL_URL/api/sessao/slack/retorno). */
  PANEL_URL: optionalString.pipe(z.url().optional()),
  /** Espaço do Slack da empresa, para o login ir direto a ele (opcional). */
  DEMO_SLACK_TEAM_ID: optionalString,
});

export const workerSchema = baseSchema.extend({
  ...database,
  ...anthropic,
  /** Token do bot do Slack (xoxb-…). Sem ele, o worker não fala no Slack. */
  SLACK_BOT_TOKEN: optionalString,
  /** GitHub App: id e chave privada (PEM; "\n" escapado é aceito). */
  GITHUB_APP_ID: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
  /** App OAuth do Linear instalado como app (actor=app). */
  LINEAR_CLIENT_ID: optionalString,
  LINEAR_CLIENT_SECRET: optionalString,
  /** Alternativa para testes: chave pessoal de API do Linear (lin_api_…). */
  LINEAR_API_KEY: optionalString,
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Intervalo da reconciliação com GitHub e Linear (padrão: 10 minutos). */
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(10 * 60_000),
  /** Repositório do espelho das notas (<org>/brains): push nele não é trabalho. */
  BRAINS_REPOSITORY: optionalString,
});

export const reviewerSchema = baseSchema.extend({ ...database, ...anthropic });

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
