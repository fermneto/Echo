import { ABSENCE, PLAN, UNASSIGNED } from "@/lib/demo/redistribution";
import { findMember } from "@/lib/demo/team";
import { teamScope } from "@/lib/scope";
import { currentDecisions } from "@/lib/decisions-store";
import { requireAccess } from "@/lib/session";
import { Redistribution } from "./Redistribution";

export const metadata = { title: "Redistribuição · Echo" };

export default async function RedistribuicaoPage() {
  const me = await requireAccess("redistribuicao");
  const TEAM = (await teamScope(me)).people;
  const decisions = await currentDecisions();
  const absent = findMember(ABSENCE.personId)!;
  // A liderança só redistribui na própria equipe.
  if (!TEAM.some((p) => p.id === absent.id)) {
    return (
      <>
        <h1 className="hero-title hero-title--page">Redistribuição</h1>
        <p className="lead">Nenhuma ausência na sua equipe pede redistribuição agora.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="hero-title hero-title--page">Redistribuição</h1>
      <p className="lead">Uma ausência vira um plano por regra, respeitando áreas e carga. Nada muda nas tarefas até você aprovar.</p>
      <Redistribution
        people={TEAM.filter((p) => p.role === "member").map((p) => p.name)}
        absence={{ name: absent.name, kind: ABSENCE.kind, from: ABSENCE.from, to: ABSENCE.to }}
        plan={PLAN}
        unassigned={UNASSIGNED}
        approved={decisions["ferias-bruno"] ?? null}
        looseApproved={decisions["ech-160"] ?? null}
      />
    </>
  );
}
