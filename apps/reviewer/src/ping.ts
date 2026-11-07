import { QUEUES, type JobQueue, type PingMessage } from "@echo/jobs";

/** O reviewer responde a cada ping com um pong, provando que a fila entrega. */
export async function registerPing(queue: JobQueue, onPing?: (msg: PingMessage) => void): Promise<void> {
  await queue.work<PingMessage>(QUEUES.reviewerPing, async (job) => {
    onPing?.(job.data);
    await queue.send<PingMessage>(QUEUES.reviewerPong, { from: "reviewer", sentAt: new Date().toISOString(), nonce: job.data.nonce });
  });
}
