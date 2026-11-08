// F2 no Slack: da mensagem que entrou pelo webhook até a resposta no tópico.
// O status do Slack é lido só na menção e nunca gravado; a pergunta é reservada para não sair duas vezes.
import { agentLabel as labelFor, detectLanguage, type AnswerRequest, type AnswerResult, type Lang } from "@echo/agents";
import { answerBlocks, REPLY_TEXT, respondToInteraction, SLACK_ACTIONS, type ChatMessage, type ChatPlatform } from "@echo/connectors";
import { absences, asSystem, identities, people, questions, withOrg, type Database } from "@echo/db";
import { avatarKey, digestKind, digestLine, isAway, parseAvatarTraits, proposalCitation, SPRITE_VERSION, traitsFromSeed } from "@echo/domain";
import type { Logger } from "@echo/observability";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

export interface SlackAnswerDeps {
  db: Database;
  chat: ChatPlatform;
  /** O fluxo de resposta da frente Funções (answer de @echo/agents). */
  answer: (req: AnswerRequest) => Promise<AnswerResult>;
  log: Logger;
  workerId: string;
  /** Ensaio de dia (DEMO_ALWAYS_AWAY): quem é citado é tratado como ausente, sem consultar o status. */
  alwaysAway?: boolean;
  now?: () => Date;
  /** Prazo do texto da pergunta, para o dono conferir (depois é apagado). */
  textTtlMs?: number;
  /** Endereço público do painel, de onde o Slack busca o bonequinho de cada agente (só https). */
  webUrl?: string;
}

export type SlackAnswerOutcome = "answered" | "silent" | "noted" | "duplicate" | "skipped";

type Known = { id: string; name: string; timezone: string; workHours: { days: number[]; start: string; end: string }; avatar?: Record<string, string> | null };

/**
 * Ícone da mensagem: o bonequinho do gêmeo (ou o do Echo), servido pelo painel. A chave dos traços vai no
 * endereço, para o Slack buscar de novo quando o desenho muda. Sem https público, fica o ícone do app.
 */
export function agentIconUrl(webUrl: string | undefined, orgId: string, owner: Pick<Known, "id" | "avatar"> | undefined): string | undefined {
  if (!webUrl?.startsWith("https://")) return undefined;
  const base = webUrl.replace(/\/$/, "");
  if (!owner) return `${base}/api/avatar/echo?v=${SPRITE_VERSION}`;
  const traits = owner.avatar ? parseAvatarTraits(owner.avatar, traitsFromSeed(owner.id)).traits : traitsFromSeed(owner.id);
  return `${base}/api/avatar/${orgId}/${owner.id}?v=${avatarKey(traits)}`;
}

/** Pessoas da empresa pelas contas do Slack. */
async function bySlack(db: Database, orgId: string, slackIds: string[]) {
  if (!slackIds.length) return new Map<string, Known>();
  const rows = await withOrg(db, orgId, (tx) =>
    tx
      .select({ slack: identities.externalId, id: people.id, name: people.name, active: people.active, timezone: people.timezone, workHours: people.workHours, avatar: people.avatar })
      .from(identities)
      .innerJoin(people, eq(people.id, identities.personId))
      .where(and(eq(identities.orgId, orgId), eq(identities.platform, "slack"), inArray(identities.externalId, slackIds))),
  );
  return new Map(rows.filter((r) => r.active).map((r) => [r.slack, { id: r.id, name: r.name, timezone: r.timezone, workHours: r.workHours, avatar: r.avatar }]));
}

/** Sem o status do Slack, vale o expediente e as ausências cadastrados (regra isAway). */
async function awayBySchedule(db: Database, orgId: string, p: Known, now: Date): Promise<boolean> {
  const abs = await withOrg(db, orgId, (tx) =>
    tx.select().from(absences).where(and(eq(absences.orgId, orgId), eq(absences.personId, p.id), isNull(absences.cancelledAt), gte(absences.endsAt, now))),
  );
  const person = { id: p.id, orgId, name: p.name, role: "member" as const, timezone: p.timezone, workHours: p.workHours, skills: [], areas: [], active: true };
  return isAway(person, abs.map((a) => ({ personId: a.personId, startsAt: a.startsAt, endsAt: a.endsAt, kind: a.kind as "vacation" })), now).away;
}

/**
 * F5b, passo 2: proposta (ou pedido de reunião) que cita uma pessoa só pelo nome, sem menção. Não há resposta
 * no canal nem leitura do status do Slack (não houve menção): vale o expediente cadastrado. Se a pessoa está
 * fora, fica só a linha do resumo da ausência dela, que some na entrega ou em 30 dias.
 */
async function noteNamedProposal(d: SlackAnswerDeps, orgId: string, m: ChatMessage, asker: Known, now: Date): Promise<SlackAnswerOutcome> {
  if (m.mentions.length > 0) return "skipped"; // menção a quem não é da empresa: não é citação pelo nome
  const rows = await withOrg(d.db, orgId, (tx) =>
    tx
      .select({ id: people.id, name: people.name, timezone: people.timezone, workHours: people.workHours })
      .from(people)
      .innerJoin(identities, and(eq(identities.personId, people.id), eq(identities.platform, "slack")))
      .where(and(eq(people.orgId, orgId), eq(people.active, true))),
  );
  const cited = proposalCitation(m.text, rows, asker.id);
  if (!cited || !(await awayBySchedule(d.db, orgId, cited, now))) return "skipped";
  const [noted] = await withOrg(d.db, orgId, (tx) =>
    tx
      .insert(questions)
      .values({
        orgId,
        askerId: asker.id,
        ownerId: cited.id,
        kind: "citacao",
        channel: `slack:${m.channel}`,
        sourceRef: `slack:${m.channel}:${m.ts}`,
        // Sem resposta: não entra nos ganhos, só no resumo.
        state: "silent",
        needsOwner: true,
        digestKind: digestKind(m.text),
        digestRequest: digestLine(m.text),
      })
      .onConflictDoNothing()
      .returning({ id: questions.id }),
  );
  return noted ? "noted" : "duplicate";
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
  // Sem dono e sem falar com o bot: proposta citada só pelo nome vai para o resumo; "quem sabe" é outro fluxo (F9).
  if (!owner && !direct) return noteNamedProposal(d, orgId, m, asker, now);

  // Status lido só agora, na menção, com limite de 1,5 s. Nunca gravado nem logado.
  // Ativo = ninguém responde por ele. Sem resposta do Slack, vale o expediente cadastrado.
  if (owner && !m.mentionsBot && !d.alwaysAway) {
    const presence = await d.chat.getPresence(ownerSlack!, 1_500);
    if (presence === "active") return "silent";
    if (presence === "unknown" && !(await awayBySchedule(d.db, orgId, owner, now))) return "silent";
  }

  // As menções viram nomes, para o modelo ler; o texto da mensagem segue como dado.
  const text = m.text.replace(/<@([UW][A-Z0-9_]+)(?:\|[^>]*)?>/g, (_, id: string) => (known.get(id) ? `@${known.get(id)!.name}` : "@alguém")).trim();
  // Com dono, a linha do pedido entra já na reserva: se a resposta falhar, o resumo da ausência mostra "sem resposta".
  // Na linha, a menção ao próprio dono sai (o resumo é para ele); as outras viram nomes.
  const forDigest = m.text.replace(/<@([UW][A-Z0-9_]+)(?:\|[^>]*)?>/g, (_, id: string) => (id === ownerSlack ? "" : known.get(id) ? `@${known.get(id)!.name}` : "@alguém"));
  const digest = owner ? { digestKind: digestKind(text), digestRequest: digestLine(forDigest) } : {};

  // Reserva: só uma execução publica. Falha antiga ou reserva parada há 5 min pode ser retomada.
  const sourceRef = `slack:${m.channel}:${m.ts}`;
  const [claimed] = await withOrg(d.db, orgId, (tx) =>
    tx
      .insert(questions)
      .values({ orgId, askerId: asker.id, ownerId: owner?.id ?? null, kind: owner ? "gemeo" : m.isDm ? "dm" : "livre", channel: `slack:${m.channel}`, sourceRef, state: "processing", claimedBy: d.workerId, ...digest })
      .onConflictDoUpdate({
        target: [questions.orgId, questions.sourceRef],
        set: { state: "processing", claimedBy: d.workerId },
        // Pergunta já dada como perdida (com aviso a quem perguntou) não volta a ser respondida.
        where: and(
          sql`${questions.digestKind} is distinct from 'falha_avisada'`,
          // Falha que já publicou resposta (acima do dobro do limite) também não sai de novo.
          or(and(eq(questions.state, "failed"), isNull(questions.answer)), and(eq(questions.state, "processing"), lt(questions.createdAt, new Date(now.getTime() - 5 * 60_000)))),
        ),
      })
      .returning({ id: questions.id }),
  );
  if (!claimed) return "duplicate";

  // Idioma da pergunta, só para o aviso de espera; a resposta traz o idioma que o agente usou.
  const asked = detectLanguage(text).lang;
  const agentLabel = labelFor(owner ? owner.name.split(" ")[0] : undefined, asked);
  // Aviso temporário no tópico, apagado depois da resposta (mensagem efêmera não pode ser apagada pelo bot).
  const threadTs = m.threadTs ?? m.ts;
  const iconUrl = agentIconUrl(d.webUrl, orgId, owner);
  const icon = iconUrl ? { iconUrl } : {};
  const notice = (await d.chat.postNotice?.({ channel: m.channel, threadTs, agentName: agentLabel, text: `_${REPLY_TEXT[asked].looking(agentLabel)}_`, ...icon }).catch(() => null)) ?? null;

  try {
    const r = await d.answer({ orgId, askerId: asker.id, ...(owner ? { ownerId: owner.id } : {}), text, channel: "slack" });
    const lang = r.language ?? asked;
    const body = [r.text, ...r.warnings.map((w) => `_${REPLY_TEXT[lang].warning}: ${w}_`)].join("\n\n");
    const blocks = answerBlocks({ text: body, sources: r.sources, questionId: claimed.id, lang });
    await d.chat.postAgentReply({ channel: m.channel, threadTs, agentName: r.agentName, text: body, ...(blocks ? { blocks } : {}), ...icon });
    await withOrg(d.db, orgId, (tx) =>
      tx
        .update(questions)
        .set({
          // Acima do dobro do limite de custo, a resposta por regra fica como falha (fora dos ganhos).
          state: r.overLimit ? "failed" : "answered",
          // O texto da pergunta fica por pouco tempo, só para o dono conferir.
          text,
          textExpiresAt: new Date(now.getTime() + (d.textTtlMs ?? 48 * 3_600_000)),
          answer: r.text,
          sources: r.sources,
          needsOwner: r.needsOwner,
          ownerReturnsAt: r.ownerReturnsAt ?? null,
          answeredAt: now,
          // Resumo da ausência (F5b): tipo e uma linha de pedido e outra de resposta, por regra no answer().
          ...(r.digest ? { digestKind: r.digest.kind, digestRequest: digest.digestRequest ?? r.digest.request, digestReply: r.digest.reply } : {}),
        })
        .where(eq(questions.id, claimed.id)),
    );
    return "answered";
  } catch (err) {
    await withOrg(d.db, orgId, (tx) => tx.update(questions).set({ state: "failed" }).where(eq(questions.id, claimed.id))).catch(() => {});
    throw err;
  } finally {
    if (notice) await d.chat.deleteMessage?.(notice.channel, notice.ts).catch((err) => d.log.warn({ err: String(err) }, "falha ao apagar o aviso consultando"));
  }
}

/** Depois deste prazo sem resposta, a pergunta vira falha e quem perguntou é avisado. */
export const GIVE_UP_MS = 60 * 60_000;

/**
 * Perguntas do Slack sem resposta há mais de 1 hora (worker caiu, API fora, tentativas esgotadas):
 * viram falha e quem perguntou recebe um aviso só para si no canal. As tentativas antes disso ficam
 * com a fila (o job que falha volta) e com a reserva, que aceita retomar uma pergunta parada.
 */
export async function giveUpStaleQuestions(d: { db: Database; chat: ChatPlatform; log: Logger; now?: () => Date }): Promise<number> {
  const now = d.now?.() ?? new Date();
  // Rotina de sistema: percorre as empresas.
  const stale = await asSystem(d.db, (tx) =>
    tx
      .update(questions)
      .set({ state: "failed", answeredAt: null })
      .where(and(sql`${questions.channel} like 'slack:%'`, inArray(questions.state, ["pending", "processing", "failed"]), lt(questions.createdAt, new Date(now.getTime() - GIVE_UP_MS)), isNull(questions.answer), sql`${questions.digestKind} is distinct from 'falha_avisada'`))
      .returning({ id: questions.id, orgId: questions.orgId, askerId: questions.askerId, ownerId: questions.ownerId, sourceRef: questions.sourceRef }),
  );
  for (const q of stale) {
    const [, channel] = (q.sourceRef ?? "").split(":");
    const names = await withOrg(d.db, q.orgId, (tx) =>
      tx
        .select({ person: people.id, name: people.name, slack: identities.externalId })
        .from(people)
        .leftJoin(identities, and(eq(identities.personId, people.id), eq(identities.platform, "slack")))
        .where(and(eq(people.orgId, q.orgId), inArray(people.id, [q.askerId, q.ownerId].filter((x): x is string => Boolean(x))))),
    );
    const asker = names.find((n) => n.person === q.askerId);
    const owner = names.find((n) => n.person === q.ownerId);
    if (asker?.slack && channel) {
      const text = `O Echo não conseguiu responder a sua pergunta a tempo. ${owner ? `Fale direto com ${owner.name.split(" ")[0]}.` : "Tente de novo daqui a pouco."}`;
      await d.chat.postEphemeral(channel, asker.slack, text).catch((err) => d.log.warn({ err: String(err) }, "falha ao avisar quem perguntou"));
    }
    // Marca o aviso para não repetir na próxima rodada.
    await withOrg(d.db, q.orgId, (tx) => tx.update(questions).set({ digestKind: "falha_avisada" }).where(eq(questions.id, q.id)));
  }
  if (stale.length) d.log.warn({ perguntas: stale.length }, "perguntas do Slack sem resposta há mais de 1 hora");
  return stale.length;
}

/** A mensagem original sem os botões, com a avaliação no rodapé. */
function ratedBlocks(original: unknown, helpful: boolean, lang: Lang): unknown[] {
  const t = REPLY_TEXT[lang];
  const blocks = Array.isArray(original) ? original.filter((b) => (b as { type?: string })?.type !== "actions") : [];
  return [...blocks, { type: "context", elements: [{ type: "mrkdwn", text: `${t.rated}: *${helpful ? t.helpful : t.notHelpful}*` }] }];
}

/** Idioma da resposta avaliada, pelo rótulo do botão clicado (os botões saem no idioma da conversa). */
function clickedLang(label: unknown): Lang {
  for (const l of ["en", "es"] as const) if (label === REPLY_TEXT[l].helpful || label === REPLY_TEXT[l].notHelpful) return l;
  return "pt";
}
const CLICK_TEXT: Record<Lang, { notAsker: string; recorded: string; already: string }> = {
  pt: { notAsker: "Só quem perguntou pode avaliar esta resposta.", recorded: "Avaliação registrada. Obrigado.", already: "Esta resposta já foi avaliada." },
  en: { notAsker: "Only the person who asked can rate this answer.", recorded: "Rating recorded. Thank you.", already: "This answer has already been rated." },
  es: { notAsker: "Solo quien preguntó puede evaluar esta respuesta.", recorded: "Evaluación registrada. Gracias.", already: "Esta respuesta ya fue evaluada." },
};

/**
 * Botões Resolveu / Não resolveu: só quem perguntou avalia, e uma vez só.
 * Na primeira avaliação, os botões saem da mensagem (replace_original pelo response_url).
 */
export async function handleSlackInteraction(
  d: { db: Database; log: Logger; respond?: typeof respondToInteraction },
  job: { orgId: string; payload: any },
): Promise<"recorded" | "already_rated" | "not_asker" | "ignored"> {
  const action = job.payload?.actions?.[0];
  const helpful = action?.action_id === SLACK_ACTIONS.answerHelpful ? true : action?.action_id === SLACK_ACTIONS.answerNotHelpful ? false : null;
  if (helpful === null || typeof action?.value !== "string") return "ignored";
  const known = await bySlack(d.db, job.orgId, [job.payload.user?.id ?? ""]);
  const who = known.get(job.payload.user?.id ?? "");
  const [q] = who
    ? await withOrg(d.db, job.orgId, (tx) =>
        tx
          .select({ askerId: questions.askerId, resolved: questions.resolved })
          .from(questions)
          .where(and(eq(questions.orgId, job.orgId), eq(questions.id, action.value), sql`${questions.state} = 'answered'`)),
      )
    : [];
  const isAsker = Boolean(who && q && q.askerId === who.id);
  // Só grava se ainda não foi avaliada: o segundo clique (ou um clique atrasado) não troca a avaliação.
  const rows = isAsker
    ? await withOrg(d.db, job.orgId, (tx) =>
        tx
          .update(questions)
          .set({ resolved: helpful })
          .where(and(eq(questions.orgId, job.orgId), eq(questions.id, action.value), eq(questions.askerId, who!.id), sql`${questions.state} = 'answered'`, isNull(questions.resolved)))
          .returning({ id: questions.id }),
      )
    : [];
  const outcome = rows.length > 0 ? "recorded" : isAsker ? "already_rated" : "not_asker";
  const url = job.payload.response_url;
  if (typeof url === "string") {
    const lang = clickedLang(action?.text?.text);
    const said = CLICK_TEXT[lang];
    const final = outcome === "recorded" ? helpful : (q?.resolved ?? null);
    const body =
      outcome !== "not_asker" && final !== null && Array.isArray(job.payload.message?.blocks)
        ? { replace_original: true, text: job.payload.message.text ?? "", blocks: ratedBlocks(job.payload.message.blocks, final, lang) }
        : { replace_original: false, response_type: "ephemeral", text: outcome === "not_asker" ? said.notAsker : outcome === "recorded" ? said.recorded : said.already };
    await (d.respond ?? respondToInteraction)(url, body).catch((err) => d.log.warn({ err: String(err) }, "falha ao responder o clique"));
  }
  return outcome;
}
