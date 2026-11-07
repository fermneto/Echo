import { planFor } from "@/lib/demo/plan";
import { requireAccess } from "@/lib/session";
import { PlanList } from "./PlanList";

export const metadata = { title: "Meu plano · Echo" };

export default async function PlanoPage() {
  const me = await requireAccess("plano");
  return (
    <>
      <h1 className="hero-title hero-title--page">Meu plano, {new Intl.DateTimeFormat("pt-BR", { timeZone: me.timezone, day: "2-digit", month: "2-digit" }).format(new Date())}</h1>
      <p className="lead">Só você vê este plano. A ordem é uma sugestão: primeiro quem está esperando, depois correções e prazos.</p>
      <PlanList initial={planFor(me.id)} />
    </>
  );
}
