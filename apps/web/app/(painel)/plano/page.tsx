import { planFor, type PlanItem } from "@/lib/demo/plan";
import { personIdFor } from "@/lib/agent";
import { dayMonth } from "@/lib/daily-note";
import { panelDb } from "@/lib/db";
import { currentDecisions } from "@/lib/decisions-store";
import { dueLabel } from "@/lib/due";
import { gainsOrgId, isDemoOrg } from "@/lib/gains";
import { loadMorningPlan, planDate } from "@/lib/pending-live";
import { pendingPlans } from "@/lib/redistribution-server";
import { requireAccess } from "@/lib/session";
import { loadAgenda } from "@/lib/work-planning";
import { decidirCorrecao, moverTarefa } from "./actions";
import { DaySchedule } from "./DaySchedule";
import { PlanList } from "./PlanList";
import "./agenda.css";

export const metadata = { title: "Meu plano · Echo" };

export default async function PlanoPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const me = await requireAccess("plano");
  const now = new Date();
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
    fixId: f.fixId,
  }));

  const agenda = await loadAgenda(me);
  const firstName = me.name.trim().split(/\s+/)[0];
  const lead = agenda ? `O agente de ${firstName} organizou seus dias por prazo, dependências e carga. Você pode mudar o dia de qualquer tarefa. Só você vê este plano.` : null;
  const schedule = agenda ? <DaySchedule today={agenda.today} schedule={agenda.schedule} move={moverTarefa} /> : null;
  // Com agenda, o prazo já aparece no dia da tarefa e não repete como pendência.
  const notDue = (it: PlanItem) => !agenda || !(it.id.startsWith("due:") || it.dueIso);

  if (!isDemoOrg(me.orgId)) {
    // Empresa conectada: o plano da manhã gravado pelo fluxo F5. Sem plano no banco, estado vazio, nunca o inventado.
    // A correção pronta vem ao vivo de fix_runs (com Aprovar e Recusar); as do plano gravado saem, para não
    // repetir nem mostrar correção já decidida.
    const date = planDate((await searchParams).data, now, me.timezone);
    const morning = await loadMorningPlan(me, date);
    const items = [...fromPlans, ...fromFixes, ...(morning ?? []).filter((it) => !(fixes && it.id.startsWith("fix:")))].filter(notDue);
    return (
      <>
        <h1 className="hero-title hero-title--page">Meu plano, {dayMonth(date)}</h1>
        <p className="lead">{lead ?? "Só você vê este plano. A ordem é uma sugestão, por regra: primeiro quem está esperando, depois prazos, depois CI e achados da revisão."}</p>
        {schedule}
        {schedule && items.length > 0 && <h2 className="plan-pending-title">Esperam você</h2>}
        {morning === null && !schedule && (
          <p className="note muted">O plano da manhã deste dia ainda não foi montado. Ele sai perto do começo do seu expediente, com as perguntas, revisões, correções e prazos que estiverem abertos.</p>
        )}
        {(items.length > 0 || (morning !== null && !schedule)) && <PlanList initial={items} decideFix={decidirCorrecao} />}
      </>
    );
  }

  // Persona da demonstração: o plano da história. Decisões já tomadas saem; prazos são escritos em relação a hoje.
  const decisions = await currentDecisions();
  const items = [
    ...fromPlans,
    ...fromFixes,
    ...planFor(me.id)
      .filter((it) => !(it.id in decisions) && !(plans && it.id === "ferias-bruno") && !(fixes && it.kind === "correção"))
      .map((it) => (it.dueIso ? { ...it, why: `O prazo ${dueLabel(it.dueIso, now, me.timezone)}.` } : it)),
  ].filter(notDue);
  return (
    <>
      <h1 className="hero-title hero-title--page">Meu plano, {new Intl.DateTimeFormat("pt-BR", { timeZone: me.timezone, day: "2-digit", month: "2-digit" }).format(new Date())}</h1>
      <p className="lead">{lead ?? "Só você vê este plano. A ordem é uma sugestão: primeiro quem está esperando, depois correções e prazos."}</p>
      {schedule}
      {schedule && items.length > 0 && <h2 className="plan-pending-title">Esperam você</h2>}
      {(!schedule || items.length > 0) && <PlanList initial={items} decideFix={decidirCorrecao} />}
    </>
  );
}
