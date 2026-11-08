import { loadConfig } from "@echo/config";
import { panelDb } from "@/lib/db";
import { verifyVideoLink } from "@/lib/video-link";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Vídeo da semana da equipe, pelo link assinado que a página de relatórios gera para quem vê a equipe. O mp4 vem
 * da Files API; nada fica em cache público.
 */
export async function GET(req: Request, ctx: { params: Promise<{ org: string; id: string }> }): Promise<Response> {
  const { org, id } = await ctx.params;
  const cfg = loadConfig("web");
  const q = new URL(req.url).searchParams;
  if (!UUID.test(org) || !UUID.test(id) || !cfg.SESSION_SECRET || !verifyVideoLink(cfg.SESSION_SECRET, org, id, q.get("exp"), q.get("sig"))) return new Response("não encontrado", { status: 404 });
  const db = panelDb();
  if (!db || !cfg.ANTHROPIC_API_KEY) return new Response("não encontrado", { status: 404 });
  const { teamVideoForStream, videoFile } = await import("@echo/agents/server");
  const v = await teamVideoForStream(db, org, id);
  if (!v) return new Response("não encontrado", { status: 404 });
  const file = await videoFile(cfg.ANTHROPIC_API_KEY, v.storageKey).catch(() => null);
  if (!file?.ok || !file.body) return new Response("vídeo indisponível", { status: 502 });
  return new Response(file.body, { headers: { "content-type": "video/mp4", "cache-control": "private, max-age=600", "x-content-type-options": "nosniff" } });
}
