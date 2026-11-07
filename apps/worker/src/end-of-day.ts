import type { DaySummary, EndOfDay } from "@echo/agents";
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
  /** Resumo do dia (etapa 26): entra na fila depois do rascunho e da confirmação pelo Slack. */
  summary?: Pick<DaySummary, "generate">;
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
      if (w.summary) await queue.send<DailyNoteJob>(QUEUES.daySummary, job.data, { singletonKey: `${key(job.data)}:rascunho` });
    }
  });

  if (w.summary) {
    const summary = w.summary;
    await queue.work<DailyNoteJob>(QUEUES.daySummary, async (job) => {
      await summary.generate(job.data.orgId, job.data.personId, job.data.date);
    });
  }
  // Confirmada pelo Slack: o resumo é montado de novo com o que a pessoa declarou.
  const confirmed = async (orgId: string, payload: unknown) => {
    const r = await w.flow.confirmFromSlack(orgId, payload);
    if (w.summary && r?.status === "confirmed") await queue.send<DailyNoteJob>(QUEUES.daySummary, { orgId, personId: r.note.personId, date: r.note.date }, { singletonKey: `${orgId}:${r.note.personId}:${r.note.date}:confirmada` });
    return r;
  };

  await queue.work<DailyNoteJob>(QUEUES.dailyNoteTimeout, async (job) => {
    await w.flow.expire(job.data.orgId, job.data.personId, job.data.date);
  });

  // Outros botões (Resolveu / Não resolveu) chegam aqui também; o fluxo da nota só trata o Confirmar dela.
  if (w.interactions) {
    w.interactions.add("nota-do-dia", async (job) => (await confirmed(job.orgId, job.payload)) ?? "ignored");
  } else {
    await queue.work<SlackInteractionJob>(QUEUES.slackInteraction, async (job) => {
      await confirmed(job.data.orgId, job.data.payload);
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
