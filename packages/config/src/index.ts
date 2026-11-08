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
  /** Segredo do webhook de deploys da Vercel (etapa 19). */
  VERCEL_WEBHOOK_SECRET: optionalString,
  /** Chave das credenciais guardadas (openssl rand -hex 32), igual em web, api e worker. */
  ENCRYPTION_KEY: optionalString.pipe(z.string().regex(/^[0-9a-f]{64}$/i, "precisa ter 64 caracteres hex (openssl rand -hex 32)").optional()),
  // A Render define PORT; localmente usamos API_PORT.
  PORT: port(3001).optional(),
  API_PORT: port(3001),
});

/** Roteador de custo: consulta simples ao gêmeo sai por regra, sem o Sonnet. false manda tudo ao modelo. */
const router = { ANSWER_ROUTER: bool.default(true) };

export const webSchema = baseSchema.extend({
  ...anthropic,
  ...router,
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
  /** GitHub App (o mesmo do worker): Meu plano confere o rascunho da correção antes de aprovar. */
  GITHUB_APP_ID: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
  /** Modelo aberto (Ollama) que lê o currículo no cadastro pelo RH. Sem ele, cargo e habilidades ficam para a ficha. */
  SLM_OLLAMA_URL: optionalString.pipe(z.string().regex(/^(https?:\/\/)?[\w.-]+(:\d+)?\/?$/, "use http://host:porta ou host:porta").optional()),
  SLM_MODEL: z.string().min(1).default("qwen3:4b-instruct"),
});

/**
 * Modelo aberto pequeno (Ollama): triagem da revisão noturna e resumo do dia (worker) e juiz da delegação da
 * correção (reviewer). Endereço do serviço: URL ou host:porta (a Render entrega host:porta). Sem ele, esses fluxos
 * usam só a regra, e nenhuma correção é unida pela delegação.
 */
const slm = {
  SLM_OLLAMA_URL: optionalString.pipe(z.string().regex(/^(https?:\/\/)?[\w.-]+(:\d+)?\/?$/, "use http://host:porta ou host:porta").optional()),
  /** Tag do modelo no Ollama (Apache 2.0). */
  SLM_MODEL: z.string().min(1).default("qwen3:4b-instruct"),
  /** Tempo máximo da triagem de um PR e do juiz da delegação (CPU, ~15 a 30 s; a primeira chamada também carrega o modelo). */
  TRIAGE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(120_000),
  /**
   * SSLM do roteador de custo da resposta (mesmo Ollama), para a dúvida da regra. Vazio = desligado (padrão): o
   * Qwen3 0.6B e o 4B erraram demais na checagem (docs/engenharia.md). O modelo precisa estar no Ollama.
   */
  SSLM_MODEL: optionalString,
  /** Tempo máximo do SSLM; passou disso, a pergunta segue para o Sonnet. */
  SSLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8_000),
};


export const workerSchema = baseSchema.extend({
  ...database,
  ...anthropic,
  /** Token do bot do Slack (xoxb-…). Sem ele, o worker não fala no Slack. */
  SLACK_BOT_TOKEN: optionalString,
  /** Só para desenvolvimento e testes: outro endereço para a Web API do Slack (ex.: um Slack falso local). */
  SLACK_API_BASE_URL: optionalString.pipe(z.url().optional()),
  /** GitHub App: id e chave privada (PEM; "\n" escapado é aceito). */
  GITHUB_APP_ID: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
  /** App OAuth do Linear instalado como app (actor=app). */
  LINEAR_CLIENT_ID: optionalString,
  LINEAR_CLIENT_SECRET: optionalString,
  /** Alternativa para testes: chave pessoal de API do Linear (lin_api_…). */
  LINEAR_API_KEY: optionalString,
  /** Google Agenda: conta de serviço com delegação no domínio (o admin do Workspace autoriza o escopo). */
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_SERVICE_ACCOUNT_KEY: optionalString,
  /** Microsoft 365: app multi-tenant; o tenant de cada empresa vem de installation_routes. */
  MICROSOFT_CLIENT_ID: optionalString,
  MICROSOFT_CLIENT_SECRET: optionalString,
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Intervalo da reconciliação com GitHub e Linear (padrão: 10 minutos). */
  RECONCILE_INTERVAL_MS: z.coerce.number().int().min(60_000).default(10 * 60_000),
  /** Repositório do espelho das notas (<org>/brains): push nele não é trabalho. */
  BRAINS_REPOSITORY: optionalString,
  // Endereço do painel, para o botão "Editar no painel" da nota do dia.
  WEB_URL: z.url().default("http://localhost:3000"),
  // Intervalo da agenda do fim do expediente (nota do dia).
  END_OF_DAY_SCAN_MS: z.coerce.number().int().min(10_000).default(300_000),
  // Hora UTC em que o lote da revisão noturna é criado, uma vez por noite por empresa.
  // Ensaio de dia: quem é citado é tratado como ausente, sem olhar o status do Slack (só para a demo).
  DEMO_ALWAYS_AWAY: bool.default(false),
  NIGHT_REVIEW_UTC_HOUR: z.coerce.number().int().min(0).max(23).default(5),
  ...slm,
  ...router,
  /** Tempo máximo do resumo do dia (a saída é maior que a da triagem). */
  SUMMARY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(900_000).default(300_000),
});

export const reviewerSchema = baseSchema.extend({
  ...database,
  ...anthropic,
  ...slm,
  // Agente e ambiente da correção no Managed Agents, criados uma vez com `pnpm --filter @echo/reviewer provision`.
  // Sem eles, não há correção.
  FIX_AGENT_ID: optionalString.pipe(z.string().startsWith("agent_", "precisa começar com agent_").optional()),
  FIX_ENVIRONMENT_ID: optionalString.pipe(z.string().startsWith("env_", "precisa começar com env_").optional()),
  // GitHub App (o mesmo do worker): lê o PR, pede o token só leitura da sessão e confere o rascunho.
  GITHUB_APP_ID: optionalString,
  GITHUB_PRIVATE_KEY: optionalString,
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
