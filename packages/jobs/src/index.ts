import { PgBoss } from "pg-boss";

/** Nomes de fila conhecidos. Toda fila nova entra aqui. */
export const QUEUES = {
  reviewerPing: "reviewer.ping",
  reviewerPong: "reviewer.pong",
  /** Aviso gravado em inbox_events, a processar (F1). */
  inboxProcess: "inbox.process",
  /** Mensagem do Slack que pede resposta do agente (F2, frente Funções). */
  slackMessage: "slack.message",
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface QueuedJob<T> {
  id: string;
  name: string;
  data: T;
}

export interface SendOptions {
  /** Chave única: o mesmo valor não gera dois jobs na mesma fila enquanto o primeiro existir. */
  singletonKey?: string;
  retryLimit?: number;
  startAfterSeconds?: number;
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
      retryLimit: opts.retryLimit ?? 3,
      retryBackoff: true,
      ...(opts.startAfterSeconds ? { startAfter: opts.startAfterSeconds } : {}),
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
