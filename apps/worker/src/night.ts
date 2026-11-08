import type { MorningPlan, NightReview } from "@echo/agents";
import { QUEUES, DEDUPE_SECONDS, type JobQueue } from "@echo/jobs";

/** Um job da noite por empresa em cada dia UTC. */
export const NIGHT_SINGLETON_SECONDS = 24 * 60 * 60;

/**
 * O job da noite faz a triagem de um PR por vez (até TRIAGE_TIMEOUT_MS cada) antes do lote. Os 15 min padrão do pg-boss
 * venciam com poucos PRs, e a fila daria o job por perdido com ele ainda rodando.
 */
export const NIGHT_JOB_EXPIRE_SECONDS = 2 * 60 * 60;

export interface OrgJob {
  orgId: string;
}
export interface MorningJob {
  orgId: string;
  personId: string;
  date: string;
}

export interface NightWiring {
  night: Pick<NightReview, "prepareAndSubmit" | "collect">;
  morning: Pick<MorningPlan, "build">;
  orgIds: () => Promise<string[]>;
  dueMorning: (now: Date) => Promise<MorningJob[]>;
  /** Hora UTC em que o lote da noite é criado. */
  nightHourUtc: number;
  now?: () => Date;
}

/**
 * F4 e F5 no worker. Uma vez por noite, por empresa: filtro e lote (até 3 tentativas, 30 min entre elas;
 * lote criado nunca é reenviado). A cada passada: busca os lotes terminados. Perto do expediente: plano da manhã.
 */
export async function registerNight(queue: JobQueue, w: NightWiring): Promise<{ tick: () => Promise<{ night: number; morning: number }> }> {
  const now = w.now ?? (() => new Date());

  await queue.work<OrgJob>(QUEUES.nightReview, async (job) => {
    await w.night.prepareAndSubmit(job.data.orgId);
  });
  await queue.work<OrgJob>(QUEUES.reviewCollect, async (job) => {
    await w.night.collect(job.data.orgId);
  });
  await queue.work<MorningJob>(QUEUES.morningPlan, async (job) => {
    await w.morning.build(job.data.orgId, job.data.personId, job.data.date);
  });

  return {
    async tick() {
      const at = now();
      const orgIds = await w.orgIds();
      let night = 0;
      if (at.getUTCHours() === w.nightHourUtc) {
        const day = at.toISOString().slice(0, 10);
        // A agenda passa a cada 5 min a hora inteira, e no deploy dois workers passam juntos. A chave sozinha não
        // impede outro job no pg-boss: a janela de um dia (UTC) é que deixa um só job por empresa na noite, mesmo
        // depois de o primeiro terminar ou falhar. O disparo manual usa outra chave e não ocupa esta.
        for (const orgId of orgIds) {
          if (await queue.send<OrgJob>(QUEUES.nightReview, { orgId }, { singletonKey: `${orgId}:${day}`, singletonSeconds: NIGHT_SINGLETON_SECONDS, retryLimit: 2, retryDelaySeconds: 30 * 60, expireInSeconds: NIGHT_JOB_EXPIRE_SECONDS })) night++;
        }
      }
      for (const orgId of orgIds) await queue.send<OrgJob>(QUEUES.reviewCollect, { orgId }, { singletonKey: orgId, singletonSeconds: DEDUPE_SECONDS.perScan, retryLimit: 1 });
      const due = await w.dueMorning(at);
      for (const d of due) await queue.send<MorningJob>(QUEUES.morningPlan, d, { singletonKey: `${d.orgId}:${d.personId}:${d.date}`, singletonSeconds: DEDUPE_SECONDS.perDay });
      return { night, morning: due.length };
    },
  };
}
