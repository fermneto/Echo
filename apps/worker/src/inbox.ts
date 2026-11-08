import { processInbox, type ChatMessage, type InboxJob, type ProcessOptions } from "@echo/connectors";
import type { Database } from "@echo/db";
import { QUEUES, DEDUPE_SECONDS, type JobQueue } from "@echo/jobs";
import { withRun, type RunRecorder } from "@echo/observability";

/** Mensagem do Slack que segue para o fluxo de resposta (F2, frente Funções). */
export interface SlackMessageJob {
  orgId: string;
  message: ChatMessage;
}

/** F1 no worker: processa cada aviso gravado e passa as mensagens adiante. Registra cada execução. */
export async function registerInbox(db: Database, queue: JobQueue, runs: RunRecorder, opts: ProcessOptions = {}): Promise<void> {
  await queue.work<InboxJob>(QUEUES.inboxProcess, async (job) => {
    await withRun(runs, "inbox", async () => {
      const result = await processInbox(db, job.data, opts);
      if (!result) return;
      const orgId = result.orgId;
      if (result.brainsPush) await queue.send(QUEUES.brainMirror, { orgId }, { singletonKey: orgId, singletonSeconds: 60 });
      for (const message of result.messages) {
        // Chave única por mensagem: reprocessar o aviso não gera duas respostas.
        await queue.send<SlackMessageJob>(QUEUES.slackMessage, { orgId, message }, { singletonKey: `${message.channel}:${message.ts}`, singletonSeconds: DEDUPE_SECONDS.perHour });
      }
    });
  });
}
