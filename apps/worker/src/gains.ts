import type { AwayDigest, Gains, GainsHistory } from "@echo/agents";
import { QUEUES, type JobQueue } from "@echo/jobs";

export interface DigestJob {
  orgId: string;
  personId: string;
  date: string;
  slot: "inicio" | "fim";
}
export interface BaselineJob {
  orgId: string;
}

export interface GainsWiring {
  digest: Pick<AwayDigest, "send" | "purge">;
  gains: Pick<Gains, "captureBaseline">;
  /** Quem está no início ou no fim do expediente, com algo para o resumo e 3 horas desde o último. */
  dueDigests: (now: Date) => Promise<DigestJob[]>;
  orgIds: () => Promise<string[]>;
  needsBaseline: (orgId: string) => Promise<boolean>;
  /** Histórico do GitHub da empresa; sem a conta ligada, null e a referência espera. */
  history: (orgId: string) => Promise<GainsHistory | null>;
  now?: () => Date;
}

/**
 * Resumo da ausência e Ganhos (etapa 13) no worker. A cada passada: um resumo por pessoa e momento (chave
 * pessoa + data + início ou fim), a limpeza das linhas com mais de 30 dias ou de quem foi desligado e, em quem
 * ainda não tem, a referência de 90 dias do GitHub (uma vez por empresa).
 */
export async function registerGains(queue: JobQueue, w: GainsWiring): Promise<{ tick: () => Promise<{ digests: number; purged: number; baselines: number }> }> {
  const now = w.now ?? (() => new Date());
  await queue.work<DigestJob>(QUEUES.awayDigestSend, async (job) => {
    const { orgId, personId, date, slot } = job.data;
    await w.digest.send(orgId, personId, { date, slot });
  });
  await queue.work<BaselineJob>(QUEUES.gainsBaseline, async (job) => {
    await w.gains.captureBaseline(job.data.orgId, await w.history(job.data.orgId));
  });
  return {
    async tick() {
      const due = await w.dueDigests(now());
      for (const d of due) await queue.send<DigestJob>(QUEUES.awayDigestSend, d, { singletonKey: `${d.orgId}:${d.personId}:${d.date}:${d.slot}`, retryLimit: 2 });
      let purged = 0;
      let baselines = 0;
      for (const orgId of await w.orgIds()) {
        purged += await w.digest.purge(orgId);
        if ((await w.needsBaseline(orgId)) && (await w.history(orgId)) && (await queue.send<BaselineJob>(QUEUES.gainsBaseline, { orgId }, { singletonKey: orgId, retryLimit: 2, expireInSeconds: 1800 }))) baselines++;
      }
      return { digests: due.length, purged, baselines };
    },
  };
}
