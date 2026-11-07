import { drainActions, orgsWithApprovedActions, releaseStuckActions, type ExecutorDeps } from "@echo/actions";
import { QUEUES, type JobQueue } from "@echo/jobs";
import { withRun, type Logger, type RunRecorder } from "@echo/observability";

/**
 * Executa o outbox: a cada rodada (e logo depois de uma aprovação, pela fila actions.drain).
 * Só ações aprovadas, ou as que não exigem aprovação, chegam aqui.
 */
export async function registerActions(deps: ExecutorDeps, queue: JobQueue, runs: RunRecorder, log: Logger, intervalMs = 15_000): Promise<() => void> {
  const drainOrg = (orgId: string) =>
    withRun(runs, "actions", async () => {
      const r = await drainActions(deps, orgId);
      if (r.done || r.failed || r.retried) log.info({ orgId, ...r }, "ações executadas");
      return r;
    }, { orgId });

  await queue.work<{ orgId: string }>(QUEUES.actionsDrain, async (job) => void (await drainOrg(job.data.orgId)));

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await releaseStuckActions(deps.db);
      for (const orgId of await orgsWithApprovedActions(deps.db)) await drainOrg(orgId).catch((err) => log.error({ err, orgId }, "falha ao executar ações"));
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
