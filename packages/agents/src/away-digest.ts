// Resumo da ausência (etapa 13, F5b). Sem modelo: as regras agrupam e o código escreve.
// Mensagem privada do Echo ao dono no início e no fim do expediente, pelo outbox. O agente nunca aceita, recusa
// ou marca nada em nome da pessoa. As linhas são apagadas na entrega, ao desligar a pessoa ou em 30 dias.
import type { OutboxAction } from "@echo/actions";
import { AWAY_DIGEST_RULES, awayDigest, type AwayDigestDue, type Clock, type DigestItem, type DigestSection, digestPurgeBefore, type Person, systemClock } from "@echo/domain";
import type { AgentRun, RunRecorder } from "@echo/observability";
import type { AgentData } from "./data.ts";

export interface DigestStore {
  /** Último resumo entregue à pessoa (o mais recente `digested_at`). */
  lastSentAt(personId: string): Promise<Date | null>;
  /** Perguntas ao agente da pessoa ainda fora de um resumo, com as linhas guardadas, criadas desde `since`. */
  pending(personId: string, since: Date): Promise<DigestItem[]>;
  /** Marca como entregues e apaga as linhas. Devolve quantas mudaram. */
  markDelivered(ids: string[], at: Date): Promise<number>;
  /** Itens que foram na mensagem já enfileirada com esta chave (payload.itemIds do outbox). */
  sentItems(idempotencyKey: string): Promise<string[]>;
  /** Apaga as linhas antigas (antes de `before`) e as de quem foi desligado ou está inativo. */
  purge(before: Date): Promise<number>;
}

export interface AwayDigestDeps {
  data: (orgId: string) => AgentData;
  store: (orgId: string) => DigestStore;
  outbox: (orgId: string) => { enqueue(action: OutboxAction): Promise<{ id: string; duplicate: boolean }> };
  recorder: RunRecorder;
  clock?: Clock;
  webUrl: string;
}

export type DigestOutcome = { status: "sent"; items: number; sections: Record<string, number> } | { status: "skipped"; reason: string };

const first = (name: string) => name.split(" ")[0] ?? name;

/** Texto da mensagem privada: quatro seções, até 20 itens em cada, o resto no painel. */
export function digestMessage(sections: DigestSection[], people: Pick<Person, "id" | "name">[], webUrl: string): { text: string; blocks: unknown[] } {
  const nameOf = (id: string | undefined) => {
    const p = id ? people.find((x) => x.id === id) : undefined;
    return p ? first(p.name) : "Alguém";
  };
  const lines = ["*Enquanto você estava fora*"];
  for (const s of sections) {
    lines.push(s.total ? `*${s.title} (${s.total}):*` : `*${s.title} (0)*`);
    for (const i of s.items) {
      const ask = `• ${nameOf(i.askerId)}: ${i.request || "mensagem sem texto guardado"}`;
      lines.push(s.key === "respondidas" && i.reply ? `${ask} → ${i.reply}` : ask);
    }
    if (s.total > s.items.length) lines.push(`E mais ${s.total - s.items.length} no painel.`);
    if (s.key === "propostas" && s.total) lines.push("_O agente não aceitou, recusou nem marcou nada por você._");
  }
  const text = lines.join("\n");
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "actions", elements: [{ type: "button", action_id: "abrir_resumo", text: { type: "plain_text", text: "Abrir no painel" }, url: `${webUrl.replace(/\/$/, "")}/plano` }] },
    ],
  };
}

export function createAwayDigest(deps: AwayDigestDeps) {
  const clock = deps.clock ?? systemClock;
  const record = (run: AgentRun) => deps.recorder.record(run).catch(() => undefined);

  /** Envia o resumo de uma pessoa num momento (início ou fim do expediente). A chave do outbox evita repetir. */
  async function send(orgId: string, personId: string, due: AwayDigestDue): Promise<DigestOutcome> {
    const started = performance.now();
    const done = async (o: DigestOutcome) => {
      await record({ flow: "away_digest", orgId, durationMs: Math.round(performance.now() - started), result: o.status === "sent" ? "ok" : "skipped", tools: o.status === "sent" ? ["slack.dm"] : [], ...(o.status === "skipped" ? { error: o.reason } : {}) });
      return o;
    };
    try {
      const now = clock.now();
      const people = await deps.data(orgId).people();
      const person = people.find((p) => p.id === personId);
      if (!person || !person.active || person.role === "hr") return done({ status: "skipped", reason: "pessoa sem resumo da ausência" });
      const store = deps.store(orgId);
      const items = await store.pending(personId, digestPurgeBefore(now));
      if (items.length === 0) return done({ status: "skipped", reason: "nada chegou enquanto a pessoa estava fora" });
      const { sections } = awayDigest(items);
      const msg = digestMessage(sections, people, deps.webUrl);
      const key = `away_digest:${personId}:${due.date}:${due.slot}`;
      const r = await deps.outbox(orgId).enqueue({ type: "slack.dm", target: `person:${personId}`, payload: { personId, text: msg.text, blocks: msg.blocks, itemIds: items.map((i) => i.id) }, idempotencyKey: key });
      if (r.duplicate) {
        // Já enviado (talvez a marcação tenha falhado depois do outbox): marca só o que foi naquela mensagem.
        await store.markDelivered(await store.sentItems(key), now);
        return done({ status: "skipped", reason: "resumo deste momento já enviado" });
      }
      // Entregue: as linhas somem e fica só a data, que conta as 3 horas até o próximo.
      await store.markDelivered(items.map((i) => i.id), now);
      return done({ status: "sent", items: items.length, sections: Object.fromEntries(sections.map((s) => [s.key, s.total])) });
    } catch (err) {
      await record({ flow: "away_digest", orgId, durationMs: Math.round(performance.now() - started), result: "failed", error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /** Linhas com mais de 30 dias e de quem foi desligado são apagadas. */
  function purge(orgId: string): Promise<number> {
    return deps.store(orgId).purge(digestPurgeBefore(clock.now()));
  }

  return { send, purge };
}

export type AwayDigest = ReturnType<typeof createAwayDigest>;
export { AWAY_DIGEST_RULES };
