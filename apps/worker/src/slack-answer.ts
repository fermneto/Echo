// F2 no Slack: da mensagem que entrou pelo webhook até a resposta no tópico.
// O status do Slack é lido só na menção e nunca gravado; a pergunta é reservada para não sair duas vezes.
import type { AnswerRequest, AnswerResult } from "@echo/agents";
import { answerBlocks, respondToInteraction, SLACK_ACTIONS, type ChatMessage, type ChatPlatform } from "@echo/connectors";
import { absences, identities, people, questions, withOrg, type Database } from "@echo/db";
import { isAway } from "@echo/domain";
import type { Logger } from "@echo/observability";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

export interface SlackAnswerDeps {
  db: Database;
  chat: ChatPlatform;
  /** O fluxo de resposta da frente Funções (answer de @echo/agents). */
  answer: (req: AnswerRequest) => Promise<AnswerResult>;
  log: Logger;
  workerId: string;
  now?: () => Date;
  /** Prazo do texto da pergunta, para o dono conferir (depois é apagado). */
  textTtlMs?: number;
}

export type SlackAnswerOutcome = "answered" | "silent" | "duplicate" | "skipped";

type Known = { id: string; name: string; timezone: string; workHours: { days: number[]; start: string; end: string } };

/** Pessoas da empresa pelas contas do Slack. */
async function bySlack(db: Database, orgId: string, slackIds: string[]) {
  if (!slackIds.length) return new Map<string, Known>();
  const rows = await withOrg(db, orgId, (tx) =>
    tx
      .select({ slack: identities.externalId, id: people.id, name: people.name, active: people.active, timezone: people.timezone, workHours: people.workHours })
      .from(identities)
      .innerJoin(people, eq(people.id, identities.personId))
      .where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack"), inArray(identities.externalId, slackIds))),
  );
  return new Map(rows.filter((r) => r.active).map((r) => [r.slack, { id: r.id, name: r.name, timezone: r.timezone, workHours: r.workHours }]));
}

/** Sem o status do Slack, vale o expediente e as ausências cadastrados (regra isAway). */
async function awayBySchedule(db: Database, orgId: string, p: Known, now: Date): Promise<boolean> {
  const abs = await withOrg(db, orgId, (tx) =>
    tx.select().from(absences).where(and(eq(absences.orgId, orgId), eq(absences.personId, p.id), isNull(absences.cancelledAt), gte(absences.endsAt, now))),
  );
  const person = { id: p.id, orgId, name: p.name, role: "member" as const, timezone: p.timezone, workHours: p.workHours, skills: [], areas: [], active: true };
  return isAway(person, abs.map((a) => ({ personId: a.personId, startsAt: a.startsAt, endsAt: a.endsAt, kind: a.kind as "vacation" })), now).away;
}

export async function handleSlackMessage(d: SlackAnswerDeps, job: { orgId: string; message: ChatMessage }): Promise<SlackAnswerOutcome> {
  const { orgId, message: m } = job;
  const now = d.now?.() ?? new Date();
  const known = await bySlack(d.db, orgId, [m.userExternalId, ...m.mentions]);
  const asker = known.get(m.userExternalId);
  if (!asker) return "skipped"; // quem pergunta não está cadastrado

  const ownerSlack = m.mentions.find((u) => u !== m.userExternalId && known.has(u));
  const owner = ownerSlack ? known.get(ownerSlack) : undefined;
  const direct = m.mentionsBot || m.isDm || Boolean(m.inEchoThread);
  // Sem dono e sem falar com o bot: "quem sabe" é outro fluxo (F9).
  if (!owner && !direct) return "skipped";

  // Status lido só agora, na menção, com limite de 1,5 s. Nunca gravado nem logado.
  // Ativo = ninguém responde por ele. Sem resposta do Slack, vale o expediente cadastrado.
  if (owner && !m.mentionsBot) {
    const presence = await d.chat.getPresence(ownerSlack!, 1_500);
    if (presence === "active") return "silent";
    if (presence === "unknown" && !(await awayBySchedule(d.db, orgId, owner, now))) return "silent";
  }

  // Reserva: só uma execução publica. Falha antiga ou reserva parada há 5 min pode ser retomada.
  const sourceRef = `slack:${m.channel}:${m.ts}`;
  const [claimed] = await withOrg(d.db, orgId, (tx) =>
    tx
      .insert(questions)
      .values({ orgId, askerId: asker.id, ownerId: owner?.id ?? null, kind: owner ? "gemeo" : m.isDm ? "dm" : "livre", channel: `slack:${m.channel}`, sourceRef, state: "processing", claimedBy: d.workerId })
      .onConflictDoUpdate({
        target: [questions.orgId, questions.sourceRef],
        set: { state: "processing", claimedBy: d.workerId },
        where: or(eq(questions.state, "failed"), and(eq(questions.state, "processing"), lt(questions.createdAt, new Date(now.getTime() - 5 * 60_000)))),
      })
      .returning({ id: questions.id }),
  );
  if (!claimed) return "duplicate";

  const agentLabel = owner ? `Agente de ${owner.name.split(" ")[0]}` : "Echo";
  await d.chat.postEphemeral(m.channel, m.userExternalId, `${agentLabel} consultando…`).catch(() => {});

  // As menções viram nomes, para o modelo ler; o texto da mensagem segue como dado.
  const text = m.text.replace(/<@([UW][A-Z0-9_]+)(?:\|[^>]*)?>/g, (_, id: string) => (known.get(id) ? `@${known.get(id)!.name}` : "@alguém")).trim();
  try {
    const r = await d.answer({ orgId, askerId: asker.id, ...(owner ? { ownerId: owner.id } : {}), text, channel: "slack" });
    const body = [r.text, ...r.warnings.map((w) => `_Aviso: ${w}_`)].join("\n\n");
    const blocks = answerBlocks({ text: body, sources: r.sources, questionId: claimed.id });
    await d.chat.postAgentReply({ channel: m.channel, threadTs: m.threadTs ?? m.ts, agentName: r.agentName, text: body, ...(blocks ? { blocks } : {}) });
    await withOrg(d.db, orgId, (tx) =>
      tx
        .update(questions)
        .set({
          state: "answered",
          // O texto da pergunta fica por pouco tempo, só para o dono conferir.
          text,
          textExpiresAt: new Date(now.getTime() + (d.textTtlMs ?? 48 * 3_600_000)),
          answer: r.text,
          sources: r.sources,
          needsOwner: r.needsOwner,
          ownerReturnsAt: r.ownerReturnsAt ?? null,
          answeredAt: now,
        })
        .where(eq(questions.id, claimed.id)),
    );
    return "answered";
  } catch (err) {
    await withOrg(d.db, orgId, (tx) => tx.update(questions).set({ state: "failed" }).where(eq(questions.id, claimed.id))).catch(() => {});
    throw err;
  }
}

/** Botões Resolveu / Não resolveu: só quem perguntou avalia. O retorno vai pelo response_url. */
export async function handleSlackInteraction(
  d: { db: Database; log: Logger; respond?: typeof respondToInteraction },
  job: { orgId: string; payload: any },
): Promise<"recorded" | "not_asker" | "ignored"> {
  const action = job.payload?.actions?.[0];
  const helpful = action?.action_id === SLACK_ACTIONS.answerHelpful ? true : action?.action_id === SLACK_ACTIONS.answerNotHelpful ? false : null;
  if (helpful === null || typeof action?.value !== "string") return "ignored";
  const known = await bySlack(d.db, job.orgId, [job.payload.user?.id ?? ""]);
  const who = known.get(job.payload.user?.id ?? "");
  const rows = who
    ? await withOrg(d.db, job.orgId, (tx) =>
        tx
          .update(questions)
          .set({ resolved: helpful })
          .where(and(eq(questions.orgId, job.orgId), eq(questions.id, action.value), eq(questions.askerId, who.id), sql`${questions.state} = 'answered'`))
          .returning({ id: questions.id }),
      )
    : [];
  const ok = rows.length > 0;
  const url = job.payload.response_url;
  if (typeof url === "string") {
    await (d.respond ?? respondToInteraction)(url, { replace_original: false, response_type: "ephemeral", text: ok ? "Avaliação registrada. Obrigado." : "Só quem perguntou pode avaliar esta resposta." }).catch((err) =>
      d.log.warn({ err: String(err) }, "falha ao responder o clique"),
    );
  }
  return ok ? "recorded" : "not_asker";
}
