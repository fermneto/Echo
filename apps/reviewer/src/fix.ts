import type { Fix } from "@echo/agents";
import { QUEUES, type JobQueue } from "@echo/jobs";

export interface FixJob {
  orgId: string;
  reviewId: string;
}

export interface FixWiring {
  fix: Pick<Fix, "pending" | "run" | "sync">;
  orgIds: () => Promise<string[]>;
  /** Tempo máximo de uma correção; o job vive um pouco mais que ele. */
  timeoutMs: number;
}

/**
 * Correção (etapa 10) no reviewer. A cada passada: revisões com achados viram um job por revisão (chave única,
 * sem nova tentativa: uma sessão custa dinheiro e a correção nunca roda duas vezes), e os rascunhos e uniões
 * feitos pelo outbox avançam o estado.
 */
export async function registerFix(queue: JobQueue, w: FixWiring): Promise<{ tick: () => Promise<{ queued: number; ready: number; applied: number }> }> {
  await queue.work<FixJob>(QUEUES.fixRun, async (job) => {
    await w.fix.run(job.data.orgId, job.data.reviewId);
  });
  const expireInSeconds = Math.ceil(w.timeoutMs / 1000) + 600;
  return {
    async tick() {
      const out = { queued: 0, ready: 0, applied: 0 };
      for (const orgId of await w.orgIds()) {
        for (const reviewId of await w.fix.pending(orgId)) {
          if (await queue.send<FixJob>(QUEUES.fixRun, { orgId, reviewId }, { singletonKey: reviewId, retryLimit: 0, expireInSeconds })) out.queued++;
        }
        const s = await w.fix.sync(orgId);
        out.ready += s.ready;
        out.applied += s.applied;
      }
      return out;
    },
  };
}
