import { planFor } from "@/lib/demo/plan";
import { currentDecisions } from "@/lib/decisions-store";
import { dueLabel } from "@/lib/due";
import { requireAccess } from "@/lib/session";
import { PlanList } from "./PlanList";

export const metadata = { title: "Meu plano · Echo" };

export default async function PlanoPage() {
  const me = await requireAccess("plano");
  const now = new Date();
  const decisions = await currentDecisions();
  // Decisões já tomadas saem do plano; prazos são escritos em relação a hoje.
  const items = planFor(me.id)
    .filter((it) => !(it.id in decisions))
    .map((it) => (it.dueIso ? { ...it, why: `O prazo ${dueLabel(it.dueIso, now, me.timezone)}.` } : it));
  return (
    <>
      <h1 className="hero-title hero-title--page">Meu plano, {new Intl.DateTimeFormat("pt-BR", { timeZone: me.timezone, day: "2-digit", month: "2-digit" }).format(new Date())}</h1>
      <p className="lead">Só você vê este plano. A ordem é uma sugestão: primeiro quem está esperando, depois correções e prazos.</p>
      <PlanList initial={items} />
    </>
  );
}
