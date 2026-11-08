import type { GainsResult } from "@echo/domain";

/** Personas da demonstração usam a empresa do seed (seed/src/demo.ts → DEMO_IDS.org). */
export const DEMO_ORG_ID = "00000000-0000-4000-8000-000000000001";

/** A persona escolhida em /entrar é da empresa "demo"; quem entrou pelo Slack tem o id real da empresa. */
export function isDemoOrg(orgId: string): boolean {
  return orgId === "demo";
}

export function gainsOrgId(orgId: string): string {
  return orgId === "demo" ? DEMO_ORG_ID : orgId;
}

export type GainsRow = { label: string; value: string; kind: "estimativa" | "medido" };

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const h = (n: number) => `${num(n)} h`;
const usd = (n: number) => (n > 0 && n < 0.01 ? "menos de US$ 0,01" : `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const before = (v: number | null, fmt: (n: number) => string) => (v === null ? "" : ` (antes: ${fmt(v)})`);

/** Linhas da tela, só com totais. Regra de exibição pura (docs/produto.md → Ganhos). */
export function gainsRows(r: GainsResult): GainsRow[] {
  if (r.status !== "ok") return [];
  const rated = r.resolved.yes + r.resolved.no;
  const rows: GainsRow[] = [
    { label: "Espera evitada", kind: "estimativa", value: r.waitAvoided.answers ? `${h(r.waitAvoided.hours)} em ${plural(r.waitAvoided.answers, "resposta", "respostas")}` : "Nenhuma resposta com o dono ausente" },
    {
      label: "Resolveram a dúvida",
      kind: "medido",
      value: rated ? `${num(r.resolved.yes)} de ${plural(rated, "avaliada", "avaliadas")}${r.resolved.unrated ? ` · ${num(r.resolved.unrated)} sem avaliação` : ""}` : r.resolved.unrated ? `Nenhuma avaliada · ${num(r.resolved.unrated)} sem avaliação` : "Nenhuma resposta",
    },
    { label: "Primeira revisão humana", kind: "medido", value: r.firstReview.hours === null ? "Sem revisão no período" : `${h(r.firstReview.hours)} de mediana${before(r.firstReview.before, h)}` },
    { label: "Idas e voltas por PR", kind: "medido", value: r.reviewRounds.perPr === null ? "Nenhum PR unido no período" : `${num(r.reviewRounds.perPr)} de mediana${before(r.reviewRounds.before, num)}` },
    { label: "Primeira análise", kind: "medido", value: r.firstAnalysis.hours === null ? "Nenhum PR analisado" : `${h(r.firstAnalysis.hours)} de mediana em ${plural(r.firstAnalysis.prs, "PR", "PRs")}` },
    { label: "Correções aproveitadas", kind: "medido", value: r.fixes.prepared ? `${num(r.fixes.approved)} de ${plural(r.fixes.prepared, "preparada", "preparadas")}` : "Nenhuma correção preparada" },
    {
      label: "Cobertura em ausências",
      kind: "medido",
      value: r.coverage.plans ? `${plural(r.coverage.tasks, "tarefa redistribuída", "tarefas redistribuídas")}${r.coverage.approvalHours === null ? "" : ` · ${h(r.coverage.approvalHours)} até a aprovação`}` : "Nenhum plano de ausência",
    },
  ];
  if (r.cost) rows.push({ label: "Custo", kind: "medido", value: `${usd(r.cost.usd)}${r.cost.perAvoidedHourUsd === null ? "" : ` · ${usd(r.cost.perAvoidedHourUsd)} por hora de espera evitada`}` });
  return rows;
}

export type GainsCompare = { label: string; unit: string; before: number; after: number };

/** Antes e depois para as barras, só quando os dois lados existem. */
export function gainsCompare(r: GainsResult): GainsCompare[] {
  if (r.status !== "ok") return [];
  const out: GainsCompare[] = [];
  if (r.firstReview.hours !== null && r.firstReview.before !== null) out.push({ label: "Primeira revisão humana", unit: "h", before: r.firstReview.before, after: r.firstReview.hours });
  if (r.reviewRounds.perPr !== null && r.reviewRounds.before !== null) out.push({ label: "Idas e voltas por PR", unit: "", before: r.reviewRounds.before, after: r.reviewRounds.perPr });
  return out;
}

/** De onde vem o "antes". */
export function baselineNote(r: GainsResult): string {
  if (r.status !== "ok") return "";
  if (!r.baseline) return "Referência de antes do Echo ainda não medida: ela sai uma vez, dos 90 dias de GitHub antes da instalação.";
  const d = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
  return `Antes: ${d(r.baseline.from)} a ${d(r.baseline.to)}, ${plural(r.baseline.prs, "PR", "PRs")}, medido uma vez.`;
}
