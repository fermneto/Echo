import type { EndOfDay } from "@echo/agents";
import { QUEUES, type JobQueue } from "@echo/jobs";
import { HOUR, NOTE_RULES } from "@echo/domain";

/** Pessoa e data local: a chave única do rascunho. */
export interface DailyNoteJob {
  orgId: string;
  personId: string;
  date: string;
}

/** Clique de botão do Slack, já verificado pela API. */
export interface SlackInteractionJob {
  orgId: string;
  payload: unknown;
}

export interface EndOfDayWiring {
  flow: Pick<EndOfDay, "draft" | "expire" | "confirmFromSlack">;
  /** Quem está no fim do expediente agora (dueEndOfDay em @echo/agents/server). */
  scan: (now: Date) => Promise<DailyNoteJob[]>;
  now?: () => Date;
  /**
   * Roteador único da fila slack.interaction (createInteractionRouter). Com ele, o Confirmar da nota entra
   * como mais um tratador; sem ele (testes), registra o consumidor direto na fila.
   */
  interactions?: { add(name: string, run: (job: SlackInteractionJob) => Promise<unknown>): void };
}

/**
 * F3 no worker: a agenda põe na fila um rascunho por pessoa e data; o rascunho criado agenda o prazo de 2 h;
 * o Confirmar do Slack confirma a nota. As regras e o registro em agent_runs ficam no fluxo (@echo/agents).
 */
export async function registerEndOfDay(queue: JobQueue, w: EndOfDayWiring): Promise<{ tick: () => Promise<number> }> {
  const now = w.now ?? (() => new Date());
  const key = (j: DailyNoteJob) => `${j.orgId}:${j.personId}:${j.date}`;

  await queue.work<DailyNoteJob>(QUEUES.dailyNoteDraft, async (job) => {
    const { orgId, personId, date } = job.data;
    const r = await w.flow.draft(orgId, personId, date);
    if (r.status === "created") {
      await queue.send<DailyNoteJob>(QUEUES.dailyNoteTimeout, job.data, { singletonKey: key(job.data), startAfterSeconds: (NOTE_RULES.confirmHours * HOUR) / 1000 });
    }
  });

  await queue.work<DailyNoteJob>(QUEUES.dailyNoteTimeout, async (job) => {
    await w.flow.expire(job.data.orgId, job.data.personId, job.data.date);
  });

  // Outros botões (Resolveu / Não resolveu) chegam aqui também; o fluxo da nota só trata o Confirmar dela.
  if (w.interactions) {
    w.interactions.add("nota-do-dia", async (job) => (await w.flow.confirmFromSlack(job.orgId, job.payload)) ?? "ignored");
  } else {
    await queue.work<SlackInteractionJob>(QUEUES.slackInteraction, async (job) => {
      await w.flow.confirmFromSlack(job.data.orgId, job.data.payload);
    });
  }

  return {
    async tick() {
      const due = await w.scan(now());
      for (const d of due) await queue.send<DailyNoteJob>(QUEUES.dailyNoteDraft, d, { singletonKey: key(d) });
      return due.length;
    },
  };
}
