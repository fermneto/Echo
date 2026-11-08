import { processInbox, type ChatMessage, type InboxJob, type ProcessOptions } from "@echo/connectors";
import type { Database } from "@echo/db";
import { DEDUPE_SECONDS, QUEUES, type JobQueue } from "@echo/jobs";
import { withRun, type RunRecorder } from "@echo/observability";

/** Mensagem do Slack que segue para o fluxo de resposta (F2, frente Funções). */
export interface SlackMessageJob {
  orgId: string;
  message: ChatMessage;
}

/**
 * F1 no worker: processa cada aviso gravado e passa as mensagens adiante. Registra a execução que aplicou algo
 * ou repassou mensagem, e toda falha; aviso só ignorado (ou já processado) não vira linha em `agent_runs`,
 * para não gravar uma linha por evento sem efeito.
 */
export async function registerInbox(db: Database, queue: JobQueue, runs: RunRecorder, opts: ProcessOptions = {}): Promise<void> {
  await queue.work<InboxJob>(QUEUES.inboxProcess, async (job) => {
    await withRun(runs, "inbox", () => handleInbox(db, queue, job.data, opts), { orgId: job.data.orgId }, {
      keep: (r) => r !== null && (r.applied > 0 || r.messages.length > 0 || Boolean(r.brainsPush)),
    });
  });
}

/** Processa o aviso e põe as mensagens na fila do F2. `null`: aviso já processado ou sem empresa. */
async function handleInbox(db: Database, queue: JobQueue, data: InboxJob, opts: ProcessOptions) {
  const result = await processInbox(db, data, opts);
  if (!result) return null;
  const orgId = result.orgId;
  if (result.brainsPush) await queue.send(QUEUES.brainMirror, { orgId }, { singletonKey: orgId });
  for (const message of result.messages) {
    // Chave única por mensagem: reprocessar o aviso não gera duas respostas.
    await queue.send<SlackMessageJob>(QUEUES.slackMessage, { orgId, message }, { singletonKey: `${message.channel}:${message.ts}`, singletonSeconds: DEDUPE_SECONDS.perHour });
  }
  return result;
}
