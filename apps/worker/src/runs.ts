import { createDbRunRecorder } from "@echo/agents/server";
import type { Database } from "@echo/db";
import type { AgentRun, Logger, RunRecorder } from "@echo/observability";

/**
 * Registro das execuções do worker: toda execução vai para o log e, quando tem empresa, para `agent_runs`
 * (painel de Execuções).
 *
 * - Sem `orgId` (ex.: pedido de reenvio dos avisos ao GitHub, que vale para todas as empresas), a linha não
 *   pode ser gravada: `agent_runs` tem RLS por empresa. Fica só no log.
 * - Falha ao gravar a linha não derruba o fluxo (senão um aviso já processado voltaria para a fila e uma
 *   mensagem poderia ser respondida duas vezes). Vai para o log como erro.
 */
export function createWorkerRunRecorder(db: Database, log: Logger, store: RunRecorder = createDbRunRecorder(db)): RunRecorder {
  return {
    async record(run: AgentRun) {
      log.info({ run }, "agent_run");
      if (!run.orgId) return;
      await store.record(run).catch((err: unknown) => log.error({ err: String(err), flow: run.flow, orgId: run.orgId }, "falha ao gravar em agent_runs"));
    },
  };
}
