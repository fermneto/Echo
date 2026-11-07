// Pergunta respondida fora do Slack (painel, simulador) gravada em `questions`, como o Slack grava: assim ela conta
// nos Ganhos, entra no resumo da ausência do dono e pode receber Resolveu / Não resolveu. Sem modelo.
import { randomUUID } from "node:crypto";
import { type Database, questions, withOrg } from "@echo/db";
import type { AnswerRequest, AnswerResult } from "./index.ts";

/** O texto da pergunta fica por pouco tempo, só para o dono conferir (o mesmo prazo do Slack). */
export const QUESTION_TEXT_TTL_MS = 48 * 3_600_000;

export async function recordQuestion(db: Database, input: { req: AnswerRequest; reply: AnswerResult; at: Date; sourceRef?: string }): Promise<string> {
  const { req, reply: r, at } = input;
  const [row] = await withOrg(db, req.orgId, (tx) =>
    tx
      .insert(questions)
      .values({
        orgId: req.orgId,
        askerId: req.askerId,
        ownerId: req.ownerId ?? null,
        kind: r.kind ?? (req.ownerId ? "gemeo" : "livre"),
        channel: req.channel,
        sourceRef: input.sourceRef ?? `${req.channel}:${randomUUID()}`,
        // Acima do dobro do limite de custo, a resposta por regra fica como falha (fora dos ganhos).
        state: r.overLimit ? "failed" : "answered",
        text: req.text,
        textExpiresAt: new Date(at.getTime() + QUESTION_TEXT_TTL_MS),
        answer: r.text,
        sources: r.sources,
        needsOwner: r.needsOwner,
        ownerReturnsAt: r.ownerReturnsAt ?? null,
        answeredAt: at,
        // Resumo da ausência (F5b): só vem quando o dono está fora.
        ...(r.digest ? { digestKind: r.digest.kind, digestRequest: r.digest.request, digestReply: r.digest.reply } : {}),
      })
      .returning({ id: questions.id }),
  );
  return row!.id;
}
