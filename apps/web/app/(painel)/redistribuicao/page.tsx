import { ABSENCE, PLAN, UNASSIGNED } from "@/lib/demo/redistribution";
import { findMember, TEAM } from "@/lib/demo/team";
import { requireAccess } from "@/lib/session";
import { Redistribution } from "./Redistribution";

export const metadata = { title: "Redistribuição · Echo" };

export default async function RedistribuicaoPage() {
  const me = await requireAccess("redistribuicao");
  const absent = findMember(ABSENCE.personId)!;
  return (
    <>
      <h1 className="hero-title hero-title--page">Redistribuição</h1>
      <p className="lead">Uma ausência vira um plano por regra, respeitando áreas e carga. Nada muda nas tarefas até você aprovar.</p>
      <Redistribution
        people={TEAM.filter((p) => p.role === "member").map((p) => p.name)}
        absence={{ name: absent.name, kind: ABSENCE.kind, from: ABSENCE.from, to: ABSENCE.to }}
        plan={PLAN}
        unassigned={UNASSIGNED}
        leader={me.name}
      />
    </>
  );
}
