import { ABSENCE, PLAN, UNASSIGNED } from "@/lib/demo/redistribution";
import { findMember, TEAM } from "@/lib/demo/team";
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
  const db = panelDb();

  if (db) {
    // Import tardio: só o leitor da Redistribuição, sem o restante do servidor dos agentes.
    const { readRedistributionPanel } = await import("@echo/agents/redistribuicao");
    const now = new Date();
    const { orgId, personId } = panelIds(me);
    const panel = await readRedistributionPanel(db, orgId, personId, now);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: me.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    return (
      <>
        <h1 className="hero-title hero-title--page">Redistribuição</h1>
        <p className="lead">{LEAD}</p>
        <LivePlans people={panel.people} plans={panel.plans.map((p) => planView(p, me.timezone))} today={today} />
      </>
    );
  }

  const decisions = await currentDecisions();
  const absent = findMember(ABSENCE.personId)!;
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
