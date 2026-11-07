import { type Contribution, type ContributionKind, inReportWindow, REPORT_RULES, type ReportState, type WeeklyMetrics } from "@echo/domain";
import type { Help, WeekReport } from "./demo/reports";

/**
 * Relatório semanal no painel: regras de exibição puras. Os números vêm de `weeklyMetrics` (packages/domain),
 * já gravados no relatório; aqui só se formata. O texto da pessoa nunca entra num número.
 */

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** "02 a 06/11"; mês diferente: "30/10 a 03/11". Datas em AAAA-MM-DD, já no fuso da pessoa. */
export function weekLabel(from: string, to: string): string {
  return from.slice(5, 7) === to.slice(5, 7) ? `${from.slice(8, 10)} a ${ddmm(to)}` : `${ddmm(from)} a ${ddmm(to)}`;
}

const KIND: Record<ContributionKind, { what: string; source: string }> = {
  coauthor: { what: "coautoria num commit", source: "GitHub" },
  review_change: { what: "revisão seguida de mudança no código", source: "GitHub" },
  panel_confirm: { what: "ajuda confirmada por quem recebeu", source: "confirmação no painel" },
  reaction: { what: "ajuda agradecida", source: "reação de obrigado no Slack" },
  unblock: { what: "destravou algo parado", source: "registro de desbloqueio" },
};

/** "linear:ECH-133" → "ECH-133"; "github:pr/41" → "PR 41". */
export function refLabel(ref: string): string {
  const pr = /^github:pr\/(\d+)/.exec(ref);
  if (pr) return `PR ${pr[1]}`;
  return ref.replace(/^linear:/, "");
}

/**
 * As ajudas que contaram no relatório, cada uma com a fonte. Mesmo filtro de `weeklyMetrics`: quem ajudou é a
 * pessoa, confirmada e dentro do período. Só referências: nenhum texto de conversa.
 */
export function helpSources(contributions: readonly Contribution[], personId: string, period: { from: Date; to: Date }, names: ReadonlyMap<string, string>): Help[] {
  return contributions
    .filter((c) => c.helperId === personId && c.helpedId !== personId && c.confirmed && inReportWindow(c, period.from, period.to))
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((c) => ({
      to: names.get(c.helpedId) ?? "Colega",
      what: c.deliveryRef ? `${KIND[c.kind].what} em ${refLabel(c.deliveryRef)}` : KIND[c.kind].what,
      source: KIND[c.kind].source,
    }));
}

/** O relatório gravado no formato do cartão. A contagem de ajudas é a das métricas, não a da lista. */
export function weekReportFrom(input: { personId: string; period: { from: string; to: string }; metrics: WeeklyMetrics; helps: Help[] }): WeekReport {
  const m = input.metrics;
  return {
    personId: input.personId,
    week: weekLabel(input.period.from, input.period.to),
    deliveries: m.deliveries,
    commits: m.commits,
    reviews: m.reviews,
    helps: input.helps,
    helpCount: m.helps,
    delays: m.delays.map((d) => (d.cause ? `${d.taskKey} (${d.cause})` : d.taskKey)),
  };
}

export type ReportTone = "wait" | "on" | "twin";
const DAY_MS = 86_400_000;

function dayMonth(at: Date, timeZone: string): string {
  return at.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone });
}

/** Onde o relatório está, em uma linha. O envio ao RH sai 3 dias depois do aviso (REPORT_RULES). */
export function reportStatus(state: ReportState, opts: { noticeAt?: Date; sentAt?: Date; timeZone: string }): { label: string; tone: ReportTone } {
  const due = opts.noticeAt ? ` · segue ao RH em ${dayMonth(new Date(opts.noticeAt.getTime() + REPORT_RULES.sendAfterNoticeDays * DAY_MS), opts.timeZone)}` : "";
  const sent = opts.sentAt ? ` em ${dayMonth(opts.sentAt, opts.timeZone)}` : "";
  switch (state) {
    case "draft":
      return { label: "Pronto para conferir · o aviso ainda não chegou ao Slack", tone: "wait" };
    case "awaiting_owner":
      return { label: `Aguardando a sua conferência${due}`, tone: "wait" };
    case "commented":
      return { label: `Observação registrada${due}`, tone: "on" };
    case "sent":
      return { label: `Enviado ao RH${sent}`, tone: "twin" };
    case "sent_without_notice":
      return { label: `Enviado ao RH${sent}, sem aviso: ele não chegou em ${REPORT_RULES.noNoticeDays} dias`, tone: "twin" };
  }
}

export const canComment = (state: ReportState) => state !== "sent" && state !== "sent_without_notice";

/**
 * "Em quê" da ajuda confirmada no painel, no formato que o fluxo aceita: "ECH-128" → linear:ECH-128,
 * "PR 31" ou "#31" → github:pr/31. Vazio é ajuda geral; o resto é recusado.
 */
export function helpRef(input: string): { ok: true; ref?: string } | { ok: false } {
  const t = input.trim();
  if (!t) return { ok: true };
  const task = /^(?:linear:)?([a-z][a-z0-9]*-\d+)$/i.exec(t);
  if (task) return { ok: true, ref: `linear:${task[1]!.toUpperCase()}` };
  const pr = /^(?:github:)?(?:pr\s*[/#-]?\s*|#)(\d+)$/i.exec(t);
  if (pr) return { ok: true, ref: `github:pr/${Number(pr[1])}` };
  return { ok: false };
}

/** O relatório mais recente de cada pessoa entre os enviados (lista do RH, uma pessoa por vez). */
export function latestPerPerson<T extends { personId: string; week: string }>(reports: readonly T[]): T[] {
  const out = new Map<string, T>();
  for (const r of reports) {
    const cur = out.get(r.personId);
    if (!cur || r.week > cur.week) out.set(r.personId, r);
  }
  return [...out.values()];
}
