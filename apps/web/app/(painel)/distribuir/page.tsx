import type { WorkBoard } from "@echo/agents";
import { panelIds } from "@/lib/redistribution-server";
import { requireAccess } from "@/lib/session";
import { workPlanningFlow } from "@/lib/work-planning";
import { atribuirTarefa } from "./actions";
import { Distribute } from "./Distribute";
import "../plano/agenda.css";

export const metadata = { title: "Distribuir tarefas · Echo" };
export const dynamic = "force-dynamic";

export default async function DistribuirPage() {
  const me = await requireAccess("distribuir");
  let board: WorkBoard | null = null;
  try {
    const flow = await workPlanningFlow();
    if (flow) board = await flow.board(panelIds(me).orgId, panelIds(me).personId);
  } catch (err) {
    console.error("mesa de distribuição não foi lida", err instanceof Error ? err.message : String(err));
  }
  return (
    <>
      <h1 className="hero-title hero-title--page">Distribuir tarefas</h1>
      <p className="lead">Você decide quem recebe. O agente de cada pessoa encaixa a tarefa na agenda dela, por prazo, dependências e carga.</p>
      {board ? <Distribute board={board} assign={atribuirTarefa} /> : <p className="note muted">Não deu para ler as tarefas da equipe agora.</p>}
    </>
  );
}
