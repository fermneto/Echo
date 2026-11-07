import { loadConfig } from "@echo/config";
import type { Database } from "@echo/db";
import { isoWeek, localDate, type Person, type ReportState } from "@echo/domain";
import { personIdFor } from "./agent";
import type { WeekReport } from "./demo/reports";
import type { Persona } from "./demo/types";
import { gainsOrgId } from "./gains";
import { canComment, helpSources, latestPerPerson, reportStatus, type ReportTone, weekLabel, weekReportFrom } from "./reports";

/**
 * Relatório semanal lido do banco (etapa 12). A permissão é a do fluxo: `view` decide quem lê (a própria pessoa
 * sempre; o RH só o enviado). Import tardio do servidor dos agentes, como nos Ganhos.
 */

export type LiveReport = {
  id: string;
  report: WeekReport;
  /** Texto verificado (regra, ou modelo aprovado pelo validador). */
  text: string;
  observations: { text: string; at: string }[];
  state: ReportState;
  status: { label: string; tone: ReportTone };
  canComment: boolean;
};

export type Ctx = { orgId: string; personId: string; people: Person[] };

async function agents() {
  return import("@echo/agents/server");
}

export async function reportFlow(db: Database) {
  const { serverWeeklyReport } = await agents();
  return serverWeeklyReport(db, undefined, loadConfig("web").PANEL_URL ?? "http://localhost:3000");
}

/** Empresa, id da pessoa no banco e as pessoas ativas da empresa. */
export async function reportContext(db: Database, persona: Persona): Promise<Ctx> {
  const { createPgAgentData } = await agents();
  const orgId = gainsOrgId(persona.orgId);
  const people = await createPgAgentData(db, orgId).people();
  return { orgId, personId: personIdFor(persona.id), people };
}

async function present(db: Database, ctx: Ctx, stored: { id: string; noticeAt?: Date; sentAt?: Date; coveredPeriod: { from: Date; to: Date } }): Promise<LiveReport | null> {
  const flow = await reportFlow(db);
  const v = await flow.view(ctx.orgId, ctx.personId, stored.id);
  if (v.status !== "ok") return null;
  const doc = v.document;
  const owner = ctx.people.find((p) => p.id === doc.personId);
  const { createPgAgentData } = await agents();
  const since = new Date(stored.coveredPeriod.from.getTime() - 14 * 86_400_000);
  const contributions = await createPgAgentData(db, ctx.orgId).contributions(since);
  const names = new Map(ctx.people.map((p) => [p.id, p.name]));
  const helps = helpSources(contributions, doc.personId, stored.coveredPeriod, names);
  return {
    id: stored.id,
    report: weekReportFrom({ personId: doc.personId, period: doc.period, metrics: doc.verified.metrics, helps }),
    text: doc.verified.text,
    observations: doc.informedByPerson.map((o) => ({ text: o.text, at: o.at })),
    state: doc.state,
    status: reportStatus(doc.state, { ...(stored.noticeAt ? { noticeAt: stored.noticeAt } : {}), ...(stored.sentAt ? { sentAt: stored.sentAt } : {}), timeZone: owner?.timezone ?? "UTC" }),
    canComment: canComment(doc.state),
  };
}

/**
 * O relatório da semana da pessoa. Antes do corte desta semana, vale o anterior ainda aberto (aguardando a
 * conferência), para ninguém perder o prazo de comentar.
 */
export async function loadMyReport(db: Database, ctx: Ctx, now = new Date()): Promise<{ week: string; live: LiveReport | null }> {
  const { createPgReportStore } = await agents();
  const me = ctx.people.find((p) => p.id === ctx.personId);
  const today = localDate(now, me?.timezone ?? "UTC");
  const week = isoWeek(today);
  const store = createPgReportStore(db, ctx.orgId);
  let stored = await store.get(ctx.personId, week);
  if (!stored) {
    const prev = await store.previous(ctx.personId, week);
    if (prev && canComment(prev.state)) stored = prev;
  }
  return { week, live: stored ? await present(db, ctx, stored) : null };
}

export type HrEntry = { personId: string; name: string; week: string };

/** RH: o enviado mais recente de cada pessoa, e o escolhido aberto. Nada de números lado a lado. */
export async function loadSentReports(db: Database, ctx: Ctx, pick?: string): Promise<{ list: HrEntry[]; current: { entry: HrEntry; live: LiveReport } | null }> {
  const { createPgReportStore } = await agents();
  const sent = latestPerPerson(await createPgReportStore(db, ctx.orgId).sentReports());
  const name = (id: string) => ctx.people.find((p) => p.id === id)?.name ?? "Pessoa";
  const owner = (id: string) => ctx.people.find((p) => p.id === id);
  const list = sent
    .map((r) => {
      const tz = owner(r.personId)?.timezone ?? "UTC";
      const to = new Date(r.coveredPeriod.to.getTime() - 1);
      return { personId: r.personId, name: name(r.personId), week: weekLabel(localDate(r.coveredPeriod.from, tz), localDate(to, tz)), stored: r };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const chosen = list.find((x) => x.personId === pick) ?? list[0];
  const live = chosen ? await present(db, ctx, chosen.stored) : null;
  const strip = ({ stored: _s, ...e }: (typeof list)[number]): HrEntry => e;
  return { list: list.map(strip), current: chosen && live ? { entry: strip(chosen), live } : null };
}

/** Quem pode ter ajudado: colegas ativos, sem a própria pessoa e sem o RH (canConfirmHelp). */
export function helpers(ctx: Ctx): { id: string; name: string }[] {
  return ctx.people
    .filter((p) => p.active && p.id !== ctx.personId && p.role !== "hr")
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
