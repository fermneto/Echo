import type { Video } from "@echo/agents";
import { QUEUES, type JobQueue } from "@echo/jobs";

export interface VideoJob {
  orgId: string;
  videoId: string;
}

/** Leituras e arrumações do banco que a agenda usa (packages/agents/src/pg-video.ts). */
export interface VideoAgenda {
  queueTeamVideos(orgId: string, now: Date): Promise<number>;
  queuedTeamVideos(orgId: string): Promise<string[]>;
  failStuckTeamVideos(orgId: string, before: Date): Promise<number>;
  expireTeamVideos(orgId: string, at: Date): Promise<string[]>;
}

export interface VideoWiring {
  video: Pick<Video, "enabled" | "process"> & { deleteFile: (id: string) => Promise<void> };
  agenda: VideoAgenda;
  orgIds: () => Promise<string[]>;
  timeoutMs: number;
  now?: () => Date;
}

/**
 * Vídeo da semana da equipe (etapa 27). A cada passada, por empresa: equipe com os relatórios da semana prontos
 * ganha o vídeo na fila; cada vídeo na fila vira um job (chave única, sem nova tentativa: cada gravação custa);
 * gravação parada vira falha; vídeo vencido sai do armazenamento.
 */
export async function registerVideo(queue: JobQueue, w: VideoWiring): Promise<{ tick: () => Promise<{ teams: number; queued: number; removed: number }> }> {
  await queue.work<VideoJob>(QUEUES.videoRun, async (job) => {
    await w.video.process(job.data.orgId, job.data.videoId);
  });
  const expireInSeconds = Math.ceil(w.timeoutMs / 1000) + 600;
  return {
    async tick() {
      const out = { teams: 0, queued: 0, removed: 0 };
      const now = (w.now ?? (() => new Date()))();
      for (const orgId of await w.orgIds()) {
        // Arrumação vale mesmo com o vídeo desligado: nada fica no armazenamento além do prazo.
        const expired = await w.agenda.expireTeamVideos(orgId, now);
        for (const id of expired) await w.video.deleteFile(id).catch(() => undefined);
        out.removed += expired.length;
        if (!w.video.enabled()) continue;
        await w.agenda.failStuckTeamVideos(orgId, new Date(now.getTime() - w.timeoutMs - 10 * 60_000));
        out.teams += await w.agenda.queueTeamVideos(orgId, now);
        for (const videoId of await w.agenda.queuedTeamVideos(orgId)) {
          if (await queue.send<VideoJob>(QUEUES.videoRun, { orgId, videoId }, { singletonKey: videoId, retryLimit: 0, expireInSeconds })) out.queued++;
        }
      }
      return out;
    },
  };
}
