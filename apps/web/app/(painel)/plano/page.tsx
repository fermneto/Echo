import { planFor, type PlanItem } from "@/lib/demo/plan";
import { dayMonth } from "@/lib/daily-note";
import { currentDecisions } from "@/lib/decisions-store";
import { dueLabel } from "@/lib/due";
import { isDemoOrg } from "@/lib/gains";
import { loadMorningPlan, planDate } from "@/lib/pending-live";
import { pendingPlans } from "@/lib/redistribution-server";
import { requireAccess } from "@/lib/session";
import { PlanList } from "./PlanList";

export const metadata = { title: "Meu plano · Echo" };

export default async function PlanoPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const me = await requireAccess("plano");
  const now = new Date();
  // Com banco, o plano de ausência vem dos planos esperando esta liderança, não da demonstração.
  const plans = await pendingPlans(me, now);
  const fromPlans: PlanItem[] = (plans ?? []).map((p) => ({ id: p.id, title: p.title, why: "Montado por regra, respeitando áreas e carga. Nada muda até você aprovar.", kind: "esperando", action: { label: "Revisar o plano", href: "/redistribuicao" } }));

  if (!isDemoOrg(me.orgId)) {
    // Empresa conectada: o plano da manhã gravado pelo fluxo F5. Sem plano no banco, estado vazio, nunca o inventado.
    const date = planDate((await searchParams).data, now, me.timezone);
    const morning = await loadMorningPlan(me, date);
    const items = [...fromPlans, ...(morning ?? [])];
    return (
      <>
        <h1 className="hero-title hero-title--page">Meu plano, {dayMonth(date)}</h1>
        <p className="lead">Só você vê este plano. A ordem é uma sugestão, por regra: primeiro quem está esperando, depois prazos, depois CI e achados da revisão.</p>
        {morning === null && (
          <p className="note muted">O plano da manhã deste dia ainda não foi montado. Ele sai perto do começo do seu expediente, com as perguntas, revisões, correções e prazos que estiverem abertos.</p>
        )}
        {(morning !== null || items.length > 0) && <PlanList initial={items} />}
      </>
    );
  }

  // Persona da demonstração: o plano da história. Decisões já tomadas saem; prazos são escritos em relação a hoje.
  const decisions = await currentDecisions();
  const items = [
    ...fromPlans,
    ...planFor(me.id)
      .filter((it) => !(it.id in decisions) && !(plans && it.id === "ferias-bruno"))
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
