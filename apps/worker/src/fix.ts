import { FIX_DECISION_TEXT, type Fix } from "@echo/agents";
import { respondToInteraction } from "@echo/connectors";
import { QUEUES, type JobQueue } from "@echo/jobs";
import type { Logger } from "@echo/observability";
import type { SlackInteractionJob } from "./slack-interactions.ts";

export interface FixJob {
  orgId: string;
  reviewId: string;
}

export interface FixWiring {
  fix: Pick<Fix, "pending" | "run" | "sync">;
  orgIds: () => Promise<string[]>;
  /** Tempo máximo de uma correção; o job vive um pouco mais que ele. */
  timeoutMs: number;
}

/**
 * Correção (etapa 10) no reviewer. A cada passada: revisões com achados viram um job por revisão (chave única,
 * sem nova tentativa: uma sessão custa dinheiro e a correção nunca roda duas vezes), e os rascunhos e uniões
 * feitos pelo outbox avançam o estado.
 */
export async function registerFix(queue: JobQueue, w: FixWiring): Promise<{ tick: () => Promise<{ queued: number; ready: number; applied: number }> }> {
  await queue.work<FixJob>(QUEUES.fixRun, async (job) => {
    await w.fix.run(job.data.orgId, job.data.reviewId);
  });
  const expireInSeconds = Math.ceil(w.timeoutMs / 1000) + 600;
  return {
    async tick() {
      const out = { queued: 0, ready: 0, applied: 0 };
      for (const orgId of await w.orgIds()) {
        for (const reviewId of await w.fix.pending(orgId)) {
          if (await queue.send<FixJob>(QUEUES.fixRun, { orgId, reviewId }, { singletonKey: reviewId, retryLimit: 0, expireInSeconds })) out.queued++;
        }
        const s = await w.fix.sync(orgId);
        out.ready += s.ready;
        out.applied += s.applied;
      }
      return out;
    },
  };
}

/**
 * Clique em Aplicar ou Recusar no privado do autor (roteador único da fila slack.interaction). Outros botões,
 * como o de link "Ver o rascunho", são ignorados. Decisão final troca a mensagem (somem os botões); o resto é
 * resposta só para quem clicou.
 */
export function fixInteractionHandler(d: { fix: Pick<Fix, "decideFromSlack">; log: Logger; respond?: typeof respondToInteraction }) {
  return async (job: SlackInteractionJob): Promise<string> => {
    const r = await d.fix.decideFromSlack(job.orgId, job.payload);
    if (!r) return "ignored";
    const url = (job.payload as { response_url?: unknown })?.response_url;
    const final = r.status === "approved" || r.status === "declined";
    if (typeof url === "string") {
      const body = final ? { replace_original: true, text: FIX_DECISION_TEXT[r.status] } : { replace_original: false, response_type: "ephemeral", text: FIX_DECISION_TEXT[r.status] };
      await (d.respond ?? respondToInteraction)(url, body).catch((err) => d.log.warn({ err: String(err) }, "falha ao responder o clique da correção"));
    }
    return r.status;
  };
}
