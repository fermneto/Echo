import { PgBoss } from "pg-boss";

/** Nomes de fila conhecidos. Toda fila nova entra aqui. */
export const QUEUES = {
  reviewerPing: "reviewer.ping",
  reviewerPong: "reviewer.pong",
  /** Aviso gravado em inbox_events, a processar (F1). */
  inboxProcess: "inbox.process",
  /** Mensagem do Slack que pede resposta do agente (F2, frente Funções). */
  slackMessage: "slack.message",
  /** Clique em botão do Slack (confirmar nota, Resolveu/Não resolveu…), já verificado. */
  slackInteraction: "slack.interaction",
  /** Pede ao worker para executar as ações aprovadas de uma empresa agora (depois de uma aprovação). */
  actionsDrain: "actions.drain",
  /** Ausência registrada (painel, RH ou agenda): a frente Funções monta a redistribuição. */
  absenceRegistered: "absence.registered",
  /** Férias detectadas na agenda: a liderança confirma antes de qualquer plano. */
  absenceSuggested: "absence.suggested",
  /** Push no repositório brains: sincronizar o espelho das notas da empresa (etapa 14). */
  brainMirror: "brain.mirror",
  /** Rascunho da nota do dia de uma pessoa (F3). Chave única: pessoa + data. */
  dailyNoteDraft: "daily_note.draft",
  /** Prazo de 2 h do rascunho: sem resposta, vira auto_unreviewed. */
  dailyNoteTimeout: "daily_note.timeout",
  /** Resumo do dia (etapa 26), montado pelo modelo aberto depois do rascunho e da confirmação. */
  daySummary: "daily_note.summary",
  /** Revisão noturna de uma empresa: filtro, lote e envio (F4). Até 3 tentativas, 30 min entre elas. */
  nightReview: "review.night",
  /** Busca os lotes terminados e publica as análises pelo outbox. */
  reviewCollect: "review.collect",
  /** Plano da manhã de uma pessoa (F5). Chave única: pessoa + data. */
  morningPlan: "morning_plan.build",
  /** Correção de uma revisão em ambiente isolado (etapa 10), no reviewer. Chave única: a revisão. */
  fixRun: "fix.run",
  /** Passada da redistribuição numa empresa: plano complementar, volta da ausência e planos concluídos. */
  redistributionScan: "redistribution.scan",
  /** Relatório semanal de uma pessoa, depois do corte (etapa 12). Chave única: pessoa + semana. */
  weeklyReportBuild: "weekly_report.build",
  /** Agenda dos relatórios de uma empresa: aviso entregue, envio ao RH em 3 dias, sem aviso em 7. */
  weeklyReportSync: "weekly_report.sync",
  /** Resumo da ausência de uma pessoa (etapa 13, F5b). Chave única: pessoa + data + início ou fim do expediente. */
  awayDigestSend: "away_digest.send",
  /** Referência dos Ganhos: 90 dias de GitHub antes do Echo, medida uma vez por empresa (etapa 13). */
  gainsBaseline: "gains.baseline",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Janelas de `singletonSeconds`: no pg-boss (política padrão), só a janela impede job repetido com a mesma chave,
 * mesmo entre os dois workers que convivem durante um deploy.
 * - `perScan`: passadas que a agenda repete a cada 5 min. Menor que o intervalo: cada passada põe um job, e duas
 *   passadas na mesma janela (dois workers) põem um só.
 * - `perHour`: avisos de fora (eventos, Slack, RH), que podem chegar de novo minutos depois.
 * - `perDay`: trabalho de uma pessoa por data (a chave já tem a data). No máximo um por dia UTC; a chave com a
 *   data local pode cair em dois dias UTC, e o fluxo também confere se já fez o trabalho.
 * Comandos de ensaio (`nota:agora`, `noite:agora`, `manha:agora`) mandam sem janela, para poder repetir.
 */
export const DEDUPE_SECONDS = { perScan: 240, perHour: 3_600, perDay: 86_400 } as const;

export interface QueuedJob<T> {
  id: string;
  name: string;
  data: T;
}

export interface SendOptions {
  /**
   * Chave do job. Sozinha, no pg-boss (fila de política padrão), não impede outro job com o mesmo valor: serve
   * para quem consome o job e só bloqueia junto com `singletonSeconds`. A fila em memória dos testes recusa a
   * chave repetida sempre.
   */
  singletonKey?: string;
  /**
   * Com `singletonKey`: no máximo um job com essa chave por janela de tantos segundos (relógio do banco, a
   * partir de 1970 em UTC; 86400 = um por dia UTC). Vale entre processos, mesmo depois de o primeiro terminar
   * ou falhar: o índice único do pg-boss recusa o segundo e `send` devolve null.
   */
  singletonSeconds?: number;
  retryLimit?: number;
  /** Espera fixa entre tentativas; sem ela, a espera cresce a cada tentativa. */
  retryDelaySeconds?: number;
  startAfterSeconds?: number;
  /** Tempo máximo do job rodando antes de a fila considerá-lo perdido (padrão do pg-boss: 15 min). */
  expireInSeconds?: number;
}

export type JobHandler<T> = (job: QueuedJob<T>) => Promise<void>;

/** Porta da fila. pg-boss no evento; trocável por SQS depois. */
export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  ensureQueue(name: string): Promise<void>;
  send<T extends object>(name: string, data: T, opts?: SendOptions): Promise<string | null>;
  work<T>(name: string, handler: JobHandler<T>): Promise<void>;
}

export class PgBossQueue implements JobQueue {
  private readonly boss: PgBoss;
  private readonly known = new Set<string>();
  private readonly polling: number;

  constructor(connectionString: string, opts: { pollingIntervalSeconds?: number } = {}) {
    this.boss = new PgBoss({ connectionString, max: 4 });
    this.polling = opts.pollingIntervalSeconds ?? 2;
    this.boss.on("error", (err) => console.error("[jobs] erro no pg-boss:", err));
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  async ensureQueue(name: string): Promise<void> {
    if (this.known.has(name)) return;
    if (!(await this.boss.getQueue(name))) await this.boss.createQueue(name);
    this.known.add(name);
  }

  async send<T extends object>(name: string, data: T, opts: SendOptions = {}): Promise<string | null> {
    await this.ensureQueue(name);
    return this.boss.send(name, data, {
      ...(opts.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts.singletonSeconds ? { singletonSeconds: opts.singletonSeconds } : {}),
      retryLimit: opts.retryLimit ?? 3,
      ...(opts.retryDelaySeconds ? { retryDelay: opts.retryDelaySeconds, retryBackoff: false } : { retryBackoff: true }),
      ...(opts.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
      ...(opts.expireInSeconds ? { expireInSeconds: opts.expireInSeconds } : {}),
    });
  }

  async work<T>(name: string, handler: JobHandler<T>): Promise<void> {
    await this.ensureQueue(name);
    await this.boss.work<T>(name, { pollingIntervalSeconds: this.polling }, async (jobs) => {
      for (const job of jobs) await handler({ id: job.id, name: job.name, data: job.data });
    });
  }
}

/** Fila em memória para testes de unidade. Entrega na hora, sem persistência. */
export class InMemoryQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly pending = new Map<string, QueuedJob<unknown>[]>();
  private readonly singletons = new Set<string>();
  private seq = 0;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async ensureQueue(): Promise<void> {}

  async send<T extends object>(name: string, data: T, opts: SendOptions = {}): Promise<string | null> {
    if (opts.singletonKey) {
      const key = `${name}:${opts.singletonKey}`;
      if (this.singletons.has(key)) return null;
      this.singletons.add(key);
    }
    const job: QueuedJob<unknown> = { id: String(++this.seq), name, data };
    const handler = this.handlers.get(name);
    if (handler) await handler(job);
    else this.pending.set(name, [...(this.pending.get(name) ?? []), job]);
    return job.id;
  }

  async work<T>(name: string, handler: JobHandler<T>): Promise<void> {
    this.handlers.set(name, handler as JobHandler<unknown>);
    const queued = this.pending.get(name) ?? [];
    this.pending.delete(name);
    for (const job of queued) await handler(job as QueuedJob<T>);
  }
}

/** Mensagem de ping entre serviços: valida que a fila entrega ao `reviewer`. */
export interface PingMessage {
  from: string;
  sentAt: string;
  nonce: string;
}
