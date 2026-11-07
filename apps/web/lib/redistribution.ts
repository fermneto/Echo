import type { PanelPlan } from "@echo/agents/redistribuicao";
import { stamp } from "./time";

/** Regras de exibição da Redistribuição (puras). Os números vêm da calculadora de carga; aqui só viram texto. */

export type Tone = "wait" | "done" | "off" | "fail";
export type ItemView = { id: string; item: string; title: string; to?: string; reason: string; load?: string; chip: { label: string; tone: Tone }; excludable: boolean };
export type PlanView = {
  id: string;
  title: string;
  state: PanelPlan["state"];
  items: ItemView[];
  /** Quem recebe algo neste plano, sem repetir. */
  receivers: string[];
  /** Resumo do que aconteceu depois da decisão. Vazio enquanto espera. */
  outcome?: { title: string; text: string };
};

const pts = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** "carga 3 de 8 pts": carga atual de quem recebe e o limite dela no período. */
export function loadLabel(load: { load: number; limit: number } | undefined): string | undefined {
  if (!load || !Number.isFinite(load.load) || !Number.isFinite(load.limit)) return undefined;
  return `carga ${pts(load.load)} de ${pts(load.limit)} pts`;
}

/** Etiqueta de cada item, honesta sobre o que já mudou no Linear ou no GitHub. */
export function itemChip(state: PanelPlan["items"][number]["state"]): { label: string; tone: Tone } {
  switch (state) {
    case "proposed":
      return { label: "proposto", tone: "wait" };
    case "unassigned":
      return { label: "sem responsável", tone: "wait" };
    case "approved":
      return { label: "aplicando", tone: "wait" };
    case "done":
      return { label: "aplicado", tone: "done" };
    case "failed":
      return { label: "não mudou", tone: "fail" };
    case "refused":
      return { label: "recusado", tone: "fail" };
    case "excluded":
      return { label: "fora do plano", tone: "off" };
  }
}

export const names = (list: string[]) => (list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} e ${list.at(-1)}`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function outcome(plan: PanelPlan, timeZone: string): PlanView["outcome"] {
  const who = plan.approvedByName ? ` por ${plan.approvedByName}` : "";
  const when = plan.decidedAt ? ` em ${stamp(plan.decidedAt, timeZone)}` : "";
  const count = (s: PanelPlan["items"][number]["state"]) => plan.items.filter((i) => i.state === s).length;
  if (plan.state === "rejected") return { title: `Plano descartado${who}${when}.`, text: "Nada mudou nas tarefas. Para outro plano, registre a ausência de novo." };
  const done = count("done");
  const pending = count("approved");
  const problems = count("failed") + count("refused");
  const loose = count("unassigned");
  const parts = [
    done ? `${plural(done, "mudança feita", "mudanças feitas")}` : "",
    pending ? `${plural(pending, "em andamento", "em andamento")} no Linear e no GitHub` : "",
    problems ? `${plural(problems, "item precisa", "itens precisam")} de outra pessoa` : "",
    loose ? `${plural(loose, "item segue", "itens seguem")} sem responsável` : "",
  ].filter(Boolean);
  const text = `${parts.length ? `${parts.join("; ")}. ` : ""}A mudança está na auditoria, em Custo e execuções.`;
  if (plan.state === "executing") return { title: `Plano aprovado${who}${when}. Aplicando.`, text };
  if (plan.state === "done") return { title: `Plano aplicado${who}${when}.`, text };
  return undefined;
}

/** Plano do banco no formato da tela. */
export function planView(plan: PanelPlan, timeZone: string): PlanView {
  const awaiting = plan.state === "awaiting_leader";
  const items = plan.items.map((i): ItemView => {
    const load = i.state === "proposed" ? loadLabel(i.load) : undefined;
    return {
      id: i.id,
      item: i.label,
      title: i.title,
      ...(i.toName ? { to: i.toName } : {}),
      reason: i.reason,
      ...(load ? { load } : {}),
      chip: itemChip(i.state),
      excludable: awaiting && (i.state === "proposed" || i.state === "unassigned"),
    };
  });
  const receivers = [...new Set(plan.items.filter((i) => i.toName && i.state !== "excluded").map((i) => i.toName!))];
  const out = outcome(plan, timeZone);
  return { id: plan.id, title: plan.title, state: plan.state, items, receivers, ...(out ? { outcome: out } : {}) };
}

/** Texto da confirmação: o que muda, quem é avisado. Itens sem responsável seguem com o motivo. */
export function confirmText(items: ItemView[], excluded: ReadonlySet<string>): { title: string; text: string; changes: number } {
  const kept = items.filter((i) => !excluded.has(i.id));
  const moving = kept.filter((i) => i.to);
  const receivers = [...new Set(moving.map((i) => i.to!))];
  const loose = kept.length - moving.length;
  const title = moving.length ? `Aplicar ${plural(moving.length, "mudança", "mudanças")} no Linear e no GitHub?` : "Aprovar sem mudanças?";
  const text = [
    receivers.length ? `${names(receivers)} ${receivers.length === 1 ? "recebe" : "recebem"} as tarefas e ${receivers.length === 1 ? "é avisado" : "são avisados"} no Slack. Cada um pode recusar com motivo.` : "",
    loose ? `${plural(loose, "item segue", "itens seguem")} sem responsável, com o motivo.` : "",
    excluded.size ? `${plural(excluded.size, "item fica", "itens ficam")} de fora.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { title, text, changes: moving.length };
}

/** "hoje", "ontem" ou a data, no fuso de quem lê. */
export function sinceLabel(at: Date, now: Date, timeZone: string): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const diff = Math.round((Date.parse(day(now)) - Date.parse(day(at))) / 86_400_000);
  if (diff <= 0) return "hoje";
  if (diff === 1) return "ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit" }).format(at);
}

const KINDS = { "Férias": "vacation", "Licença": "leave", "Ausência imprevista": "unexpected" } as const;
export type AbsenceKindLabel = keyof typeof KINDS;
export const ABSENCE_KINDS = Object.keys(KINDS) as AbsenceKindLabel[];

/** Tipo escolhido no formulário → tipo da ausência no fluxo. Desconhecido vira null. */
export function absenceKind(label: string): (typeof KINDS)[AbsenceKindLabel] | null {
  return (KINDS as Record<string, (typeof KINDS)[AbsenceKindLabel]>)[label] ?? null;
}

/** Item do Meu plano e do "Tarefas aguardando você" para um plano esperando a liderança. */
export function pendingPlanItem(p: { id: string; title: string; createdAt: Date }, now: Date, timeZone: string) {
  return { id: `plano-${p.id}`, title: p.title, since: sinceLabel(p.createdAt, now, timeZone) };
}
