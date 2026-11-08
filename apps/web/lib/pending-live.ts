import type { WaitingItem } from "@echo/agents/painel";
import { localDate, type PlanItem as StoredPlanItem } from "@echo/domain";
import { personIdFor } from "./agent";
import { panelDb } from "./db";
import type { PlanItem } from "./demo/plan";
import type { Persona } from "./demo/types";
import { gainsOrgId } from "./gains";
import type { WaitingView } from "@/components/WaitingStrip";

/**
 * Pendências reais de quem é de empresa conectada: "Tasks aguardando você" no Início e o Meu plano. Tudo vem do
 * banco da empresa (packages/agents → painel), com as regras do plano da manhã; sem dado, lista vazia.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const prNumber = (ref: string) => /^github:pr\/(\d+)$/.exec(ref)?.[1];

/** Onde cada pendência se resolve no painel: a nota na Nota do dia; o resto, no Meu plano. */
const actionFor = (kind: WaitingItem["kind"]): WaitingView["action"] => (kind === "daily_note" ? { label: "Conferir a nota", href: "/nota-do-dia" } : { label: "Ver no meu plano", href: "/plano" });

const LABEL: Record<WaitingItem["kind"], string> = { fix_ready: "Correção", question: "Pergunta", review_request: "Revisão", daily_note: "Nota do dia" };

const DETAIL: Record<WaitingItem["kind"], string> = {
  fix_ready: "A revisão noturna deixou a correção num rascunho separado do PR. Nada foi aprovado nem unido: só você decide.",
  question: "O seu agente respondeu o que estava registrado, mas a pergunta precisa de você.",
  review_request: "A revisão deste PR foi pedida a você no GitHub.",
  daily_note: "Quem pergunta ao seu agente vê o aviso de que a nota ainda não foi confirmada por você.",
};

/** Pendência do banco no formato da faixa do Início. Pura. */
export function waitingView(w: WaitingItem): WaitingView {
  const pr = prNumber(w.ref);
  return { key: w.id, id: pr && w.kind === "review_request" ? `PR ${pr}` : LABEL[w.kind], text: w.text, since: w.reason, detail: DETAIL[w.kind], action: actionFor(w.kind) };
}

const KIND: Record<StoredPlanItem["kind"], PlanItem["kind"]> = {
  fix_ready: "correção",
  question: "esperando",
  review_request: "revisão",
  task_due: "prazo",
  task_overdue: "prazo",
  finding: "correção",
  ci_failed: "correção",
  own_pr_waiting: "revisão",
};

/** Item do plano da manhã gravado no formato de Meu plano. O motivo é o escrito pela regra. Pura. */
export function planItemView(i: StoredPlanItem): PlanItem {
  const reason = i.reason ? `${i.reason.charAt(0).toUpperCase()}${i.reason.slice(1)}.` : "";
  return { id: i.id, title: i.text, why: reason, kind: KIND[i.kind] ?? "esperando" };
}

type Reader<T> = (orgId: string, personId: string) => Promise<T>;

/** "Tasks aguardando você" de quem é de empresa conectada, sem os planos de ausência (vêm de pendingPlans). */
export async function loadWaiting(me: Persona, now: Date, deps: { read?: Reader<WaitingItem[]> } = {}): Promise<WaitingView[]> {
  try {
    const read =
      deps.read ??
      (async (orgId: string, personId: string) => {
        const db = panelDb();
        if (!db) return [];
        return (await import("@echo/agents/painel")).readWaiting(db, orgId, personId, now);
      });
    return (await read(gainsOrgId(me.orgId), personIdFor(me.id))).map(waitingView);
  } catch (err) {
    console.error("pendências do banco não foram lidas", err instanceof Error ? err.message : String(err));
    return [];
  }
}

/** Data do plano: a pedida na URL (link do Slack, ?data=AAAA-MM-DD) ou hoje no fuso da pessoa. */
export function planDate(asked: string | undefined, now: Date, timeZone: string): string {
  return asked && ISO_DATE.test(asked) ? asked : localDate(now, timeZone);
}

/** Plano da manhã gravado para a pessoa na data. Sem plano no banco, lista vazia: nunca o da demonstração. */
export async function loadMorningPlan(me: Persona, date: string, deps: { read?: (orgId: string, personId: string, date: string) => Promise<StoredPlanItem[] | null> } = {}): Promise<PlanItem[] | null> {
  try {
    const read =
      deps.read ??
      (async (orgId: string, personId: string, d: string) => {
        const db = panelDb();
        if (!db) return null;
        return (await import("@echo/agents/painel")).readMorningPlan(db, orgId, personId, d);
      });
    const items = await read(gainsOrgId(me.orgId), personIdFor(me.id), date);
    return items ? items.map(planItemView) : null;
  } catch (err) {
    console.error("plano da manhã não foi lido", err instanceof Error ? err.message : String(err));
    return null;
  }
}
