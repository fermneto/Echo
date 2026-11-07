// Um só consumidor da fila slack.interaction. Cada clique vai para todos os tratadores registrados,
// e cada um ignora os botões que não são dele (Resolveu/Não resolveu, Confirmar a nota do dia…).
// Com dois consumidores na mesma fila, cada clique iria para só um deles e poderia se perder.
import { QUEUES, type JobQueue } from "@echo/jobs";
import type { Logger } from "@echo/observability";

export interface SlackInteractionJob {
  orgId: string;
  payload: unknown;
}

export type InteractionHandler = (job: SlackInteractionJob) => Promise<unknown>;

export function createInteractionRouter(log: Logger) {
  const handlers: { name: string; run: InteractionHandler }[] = [];
  return {
    /** Registra um tratador. Chame antes de `listen`. */
    add(name: string, run: InteractionHandler): void {
      handlers.push({ name, run });
    },
    /** Entrega o clique a todos; a falha de um não impede os outros, e o erro sobe para a fila tentar de novo. */
    async dispatch(job: SlackInteractionJob): Promise<void> {
      const errors: unknown[] = [];
      for (const h of handlers) {
        try {
          const outcome = await h.run(job);
          if (outcome !== undefined && outcome !== "ignored") log.info({ orgId: job.orgId, handler: h.name, outcome }, "clique no Slack");
        } catch (err) {
          log.error({ orgId: job.orgId, handler: h.name, err: String(err) }, "falha ao tratar clique");
          errors.push(err);
        }
      }
      if (errors.length) throw errors[0];
    },
    async listen(queue: JobQueue): Promise<void> {
      await queue.work<SlackInteractionJob>(QUEUES.slackInteraction, (job) => this.dispatch(job.data));
    },
  };
}
