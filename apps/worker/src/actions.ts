import { drainActions, orgsWithApprovedActions, releaseStuckActions, retryActionsWithoutExecutor, type ExecutorDeps } from "@echo/actions";
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
  // Ações que um worker antigo deu como "sem executor" voltam para a fila agora que o executor existe;
  // a primeira rodada, logo abaixo, já executa as aprovadas.
  const requeued = await retryActionsWithoutExecutor(deps.db).catch((err) => (log.error({ err }, "falha ao recolocar ações sem executor"), 0));
  if (requeued) log.info({ requeued }, "ações sem executor recolocadas na fila");

  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
