import type { Database } from "@echo/db";
import { loadConfig } from "@echo/config";
import { signedVideoPath } from "./video-link";

/** Vídeo da semana de uma equipe como a página mostra: link assinado só quando está pronto. */
export type TeamVideo = {
  id: string;
  teamName: string;
  weekLabel: string;
  state: "queued" | "recording" | "ready" | "failed";
  durationS: number | null;
  chapters: { at: number; title: string }[];
  url: string | null;
};

/** Último vídeo de cada equipe visível para a pessoa (a página já recortou as equipes pelo papel). */
export async function loadTeamVideos(db: Database, orgId: string, teamIds: readonly string[]): Promise<TeamVideo[]> {
  const { latestTeamVideos } = await import("@echo/agents/server");
  const secret = loadConfig("web").SESSION_SECRET;
  return (await latestTeamVideos(db, orgId, teamIds)).map((v) => ({
    id: v.id,
    teamName: v.teamName,
    weekLabel: v.weekLabel,
    state: v.state,
    durationS: v.durationS,
    chapters: v.chapters,
    url: v.playable && secret ? signedVideoPath(secret, orgId, v.id) : null,
  }));
}
