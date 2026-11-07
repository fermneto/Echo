import { planFor, type PlanItem } from "@/lib/demo/plan";
import { currentDecisions } from "@/lib/decisions-store";
import { dueLabel } from "@/lib/due";
import { pendingPlans } from "@/lib/redistribution-server";
import { requireAccess } from "@/lib/session";
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
