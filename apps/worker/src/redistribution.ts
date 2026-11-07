import type { Redistribution } from "@echo/agents";
import { QUEUES, type JobQueue } from "@echo/jobs";

/** Carga de `absence.registered`, enviada pela API (painel ou aviso do RH) e pela agenda. */
export interface AbsenceJob {
  orgId: string;
  absenceId: string;
}
export interface OrgJob {
  orgId: string;
}

export interface RedistributionWiring {
  flow: Pick<Redistribution, "propose" | "scan" | "sync">;
  orgIds: () => Promise<string[]>;
}

/**
 * Redistribuição (etapa 11) no worker. Ausência registrada: plano por regra para a liderança (um por ausência).
 * A cada passada, por empresa: plano complementar, volta da ausência e planos já executados.
 * Aprovar, recusar e trocar a pessoa vêm do painel (API), não daqui.
 */
export async function registerRedistribution(queue: JobQueue, w: RedistributionWiring): Promise<{ tick: () => Promise<number> }> {
  await queue.work<AbsenceJob>(QUEUES.absenceRegistered, async (job) => {
    await w.flow.propose(job.data.orgId, job.data.absenceId);
  });
  await queue.work<OrgJob>(QUEUES.redistributionScan, async (job) => {
    await w.flow.sync(job.data.orgId);
    await w.flow.scan(job.data.orgId);
  });
  return {
    async tick() {
      let queued = 0;
      for (const orgId of await w.orgIds()) if (await queue.send<OrgJob>(QUEUES.redistributionScan, { orgId }, { singletonKey: orgId, retryLimit: 1 })) queued++;
      return queued;
    },
  };
}
