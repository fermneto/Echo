import { planFor, type PlanItem } from "@/lib/demo/plan";
import { currentDecisions } from "@/lib/decisions-store";
import { dueLabel } from "@/lib/due";
import { pendingPlans } from "@/lib/redistribution-server";
import { requireAccess } from "@/lib/session";
import { personIdFor } from "@/lib/agent";
import { panelDb } from "@/lib/db";
import { gainsOrgId } from "@/lib/gains";
import { PlanList } from "./PlanList";

export const metadata = { title: "Meu plano · Echo" };

export default async function PlanoPage() {
  const me = await requireAccess("plano");
  const now = new Date();
  const decisions = await currentDecisions();
  // Decisões já tomadas saem do plano; prazos são escritos em relação a hoje.
  // Com banco, o plano de ausência vem dos planos esperando esta liderança, não da demonstração.
  const plans = await pendingPlans(me, now);
  const fromPlans: PlanItem[] = (plans ?? []).map((p) => ({ id: p.id, title: p.title, why: "Montado por regra, respeitando áreas e carga. Nada muda até você aprovar.", kind: "esperando", action: { label: "Revisar o plano", href: "/redistribuicao" } }));
  // Com banco, as correções prontas vêm de fix_runs, com o motivo de a delegação não ter coberto.
  const db = panelDb();
  const fixes = db ? await import("@echo/agents/perfil").then(({ readPlanFixes }) => readPlanFixes(db, gainsOrgId(me.orgId), personIdFor(me.id))) : null;
  const fromFixes: PlanItem[] = (fixes ?? []).map((f) => ({
    id: `fix:${f.fixId}`,
    title: `Correção pronta no PR ${f.pr.number} (${f.pr.repository})`,
    why: [`A revisão noturna deixou a correção no rascunho ${f.draftPrNumber}; ${f.tests === "passou" ? "os testes relatados passaram" : f.tests === "falhou" ? "o agente relatou falha nos testes" : "o agente não rodou os testes"}. Nada foi aprovado.`, f.delegationNote].filter(Boolean).join(" "),
    kind: "correção",
  }));
  const items = [
    ...fromPlans,
    ...fromFixes,
    ...planFor(me.id)
      .filter((it) => !(it.id in decisions) && !(plans && it.id === "ferias-bruno") && !(fixes && it.kind === "correção"))
      .map((it) => (it.dueIso ? { ...it, why: `O prazo ${dueLabel(it.dueIso, now, me.timezone)}.` } : it)),
  ];
  return (
    <>
      <h1 className="hero-title hero-title--page">Meu plano, {new Intl.DateTimeFormat("pt-BR", { timeZone: me.timezone, day: "2-digit", month: "2-digit" }).format(new Date())}</h1>
      <p className="lead">Só você vê este plano. A ordem é uma sugestão: primeiro quem está esperando, depois correções e prazos.</p>
      <PlanList initial={items} />
    </>
  );
}
