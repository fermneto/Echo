import { avatarResponse } from "@/lib/avatar";
import { panelDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Ícone do agente da pessoa no Slack e onde mais o gêmeo aparecer: `/api/avatar/<empresa>/<pessoa>?v=<chave>`. */
export async function GET(req: Request, ctx: { params: Promise<{ org: string; person: string }> }): Promise<Response> {
  const { org, person } = await ctx.params;
  const db = panelDb();
  if (!db) return new Response("sem banco", { status: 404 });
  const { readAvatar } = await import("@echo/agents/server");
  return avatarResponse(org, person, (orgId, personId) => readAvatar(db, orgId, personId), new URL(req.url).searchParams.has("v"));
}
