import { ABSENCE, PLAN, UNASSIGNED } from "@/lib/demo/redistribution";
import { findMember } from "@/lib/demo/team";
import { scopeDbIds, teamScope } from "@/lib/scope";
import { currentDecisions } from "@/lib/decisions-store";
import { panelDb } from "@/lib/db";
import { planView } from "@/lib/redistribution";
import { panelIds } from "@/lib/redistribution-server";
import { requireAccess } from "@/lib/session";
import { LivePlans } from "./LivePlans";
import { Redistribution } from "./Redistribution";
import "./redistribuicao.css";

export const metadata = { title: "Redistribuição · Echo" };
export const dynamic = "force-dynamic";

const LEAD = "Uma ausência vira um plano por regra, respeitando áreas e carga. Nada muda nas tarefas até você aprovar.";

export default async function RedistribuicaoPage() {
  const me = await requireAccess("redistribuicao");
  const scope = await teamScope(me);
  const TEAM = scope.people;
  const db = panelDb();

  if (db) {
    // Import tardio: só o leitor da Redistribuição, sem o restante do servidor dos agentes.
    const { readRedistributionPanel } = await import("@echo/agents/redistribuicao");
    const now = new Date();
    const { orgId, personId } = panelIds(me);
    const panel = await readRedistributionPanel(db, orgId, personId, now);
    // A liderança só registra ausência de quem é da própria equipe.
    const ids = scopeDbIds(scope);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: me.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return (
      <>
        <h1 className="hero-title hero-title--page">Redistribuição</h1>
        <p className="lead">{LEAD}</p>
        <LivePlans people={panel.people.filter((p) => ids.has(p.id))} plans={panel.plans.map((p) => planView(p, me.timezone))} today={today} />
      </>
    );
  }

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
      <p className="lead">{LEAD}</p>
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
