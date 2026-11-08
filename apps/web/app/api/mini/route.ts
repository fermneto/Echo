import { canSee } from "@/lib/access";
import { loadMini } from "@/lib/mini-live";
import { currentPersona, demoMode } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Tarefas atuais e mensagens do agente da própria pessoa, para a janelinha flutuante. */
export async function GET(): Promise<Response> {
  const me = await currentPersona();
  if (!me) return new Response("sem sessão", { status: 401 });
  if (!canSee(me.role, "plano", { demo: demoMode() })) return new Response("não encontrado", { status: 404 });
  return Response.json(await loadMini(me, new Date()), { headers: { "Cache-Control": "no-store" } });
}
