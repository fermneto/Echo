// Espelho das notas no repositório brains (etapa 14): o worker só liga as peças.
// As regras ficam em @echo/brain (syncMirror); a escrita no GitHub, no outbox de @echo/actions.
import { enqueueAction } from "@echo/actions";
import { syncMirror } from "@echo/brain/pg";
import { githubForOrg, type Platforms } from "@echo/connectors";
import type { Database } from "@echo/db";
import { QUEUES, type JobQueue } from "@echo/jobs";
import { withRun, type Logger, type RunRecorder } from "@echo/observability";

export interface MirrorDeps {
  db: Database;
  platforms: Platforms;
  runs: RunRecorder;
  log: Logger;
  brainsRepository?: string | undefined;
  queue?: Pick<JobQueue, "send">;
}

/** Uma rodada do espelho para a empresa: importa edições do Git e põe as exportações no outbox. */
export async function mirrorOrg(d: MirrorDeps, orgId: string): Promise<{ imported: number; exported: number; removed: number; warnings: number } | null> {
  const repo = d.brainsRepository;
  if (!repo) return null;
  const gh = await githubForOrg(d.db, d.platforms, orgId);
  if (!gh) return null;
  return withRun(d.runs, "brain_mirror", async () => {
    const r = await syncMirror(d.db, orgId, gh, repo);
    let exported = 0;
    let removed = 0;
    for (const e of r.exports) {
      // A chave inclui o sha esperado e o novo: o mesmo conteúdo sobre o mesmo arquivo nunca é escrito duas vezes.
      const { duplicate } = await enqueueAction(d.db, orgId, {
        type: "github.mirror_write",
        target: `github:${repo}`,
        idempotencyKey: `mirror:${e.noteId}:${e.previousSha ?? "novo"}:${e.sha}`,
        payload: { repo, noteId: e.noteId, path: e.path, content: e.content, ...(e.previousSha ? { previousSha: e.previousSha } : {}) },
      });
      if (!duplicate) exported++;
    }
    // Nota que deixou de poder estar no repositório (ficou pessoal ou privada, ou a empresa ganhou outra equipe).
    for (const e of r.removals) {
      const { duplicate } = await enqueueAction(d.db, orgId, {
        type: "github.mirror_delete",
        target: `github:${repo}`,
        idempotencyKey: `mirror-del:${e.noteId}:${e.sha}`,
        payload: { repo, noteId: e.noteId, path: e.path, sha: e.sha },
      });
      if (!duplicate) removed++;
    }
    if (exported + removed) await d.queue?.send(QUEUES.actionsDrain, { orgId });
    const summary = { imported: r.imported, conflicts: r.conflicts, exported, removed, warnings: r.warnings.length, truncated: r.truncated };
    d.log.info({ orgId, ...summary }, "espelho das notas");
    return { imported: r.imported, exported, removed, warnings: r.warnings.length };
  }, { orgId });
}

/** Push no repositório brains: sincroniza a empresa na hora, sem esperar a próxima rodada. */
export async function registerMirror(d: MirrorDeps & { queue: JobQueue }): Promise<void> {
  await d.queue.work<{ orgId: string }>(QUEUES.brainMirror, async (job) => void (await mirrorOrg(d, job.data.orgId)));
}
