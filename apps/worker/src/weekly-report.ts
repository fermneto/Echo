import type { WeeklyReport } from "@echo/agents";
import { QUEUES, DEDUPE_SECONDS, type JobQueue } from "@echo/jobs";

export interface ReportJob {
  orgId: string;
  personId: string;
  week: string;
  /** ISO: fim do último expediente da semana, no fuso da pessoa. */
  cutoff: string;
}
export interface OrgJob {
  orgId: string;
}

export interface WeeklyReportWiring {
  flow: Pick<WeeklyReport, "build" | "sync">;
  orgIds: () => Promise<string[]>;
  /** Relatórios que passaram do corte e ainda não existem. */
  due: (now: Date) => Promise<ReportJob[]>;
  now?: () => Date;
}

/**
 * Relatório semanal (etapa 12) no worker. Depois do corte de cada pessoa: um relatório por semana (chave pessoa +
 * semana). A cada passada, por empresa: aviso entregue, envio ao RH em 3 dias e `sent_without_notice` em 7.
 */
export async function registerWeeklyReport(queue: JobQueue, w: WeeklyReportWiring): Promise<{ tick: () => Promise<{ built: number; synced: number }> }> {
  const now = w.now ?? (() => new Date());
  await queue.work<ReportJob>(QUEUES.weeklyReportBuild, async (job) => {
    await w.flow.build(job.data.orgId, job.data.personId, job.data.week, new Date(job.data.cutoff));
  });
  await queue.work<OrgJob>(QUEUES.weeklyReportSync, async (job) => {
    await w.flow.sync(job.data.orgId);
  });
  return {
    async tick() {
      const due = await w.due(now());
      for (const d of due) await queue.send<ReportJob>(QUEUES.weeklyReportBuild, d, { singletonKey: `${d.orgId}:${d.personId}:${d.week}`, singletonSeconds: DEDUPE_SECONDS.perDay, retryLimit: 2 });
      let synced = 0;
      for (const orgId of await w.orgIds()) if (await queue.send<OrgJob>(QUEUES.weeklyReportSync, { orgId }, { singletonKey: orgId, singletonSeconds: DEDUPE_SECONDS.perScan, retryLimit: 1 })) synced++;
      return { built: due.length, synced };
    },
  };
}
