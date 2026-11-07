import Link from "next/link";
import { reportFor, SENT_TO_HR, summaryLine } from "@/lib/demo/reports";
import { findMember } from "@/lib/demo/team";
import { scopeDbIds, teamScope } from "@/lib/scope";
import { scopeLabel, TeamPicker } from "@/components/TeamPicker";
import type { Persona } from "@/lib/demo/types";
import { panelDb } from "@/lib/db";
import { panelPersona } from "@/lib/panel-person";
import { helpers, loadMyReport, loadSentReports, reportContext } from "@/lib/reports-db";
import { requireAccess } from "@/lib/session";
import { PixelAvatar } from "@/components/PixelAvatar";
import { HelpForm, Helps, LiveHelpForm, LiveReportCard, ReportCard } from "./ReportCard";

export const metadata = { title: "Relatórios · Echo" };
export const dynamic = "force-dynamic";

const HR_TITLE = "Relatórios enviados";
const HR_LEAD = "O que cada pessoa conferiu e enviou nesta semana. Sem nota, sem ranking e sem acesso às notas de ninguém.";
const MY_TITLE = "Meus relatórios";
const MY_LEAD = "O Echo resume a sua semana a partir do GitHub e do Linear, com crédito por cada ajuda. Você confere e comenta; três dias depois do aviso, ele segue ao RH.";

type HrItem = { id: string; persona: Persona; week: string };

/** Lista e detalhe do RH: uma pessoa por vez, abrindo pelas ajudas, com os números só no texto. */
function HrReports({ items, current, detail }: { items: HrItem[]; current: string; detail: React.ReactNode }) {
  return (
    <div className="hr-reports">
      <nav className="hr-reports__list" aria-label="Pessoas com relatório enviado">
        {items.map((x) => (
          <Link key={x.id} href={`/relatorios?pessoa=${x.id}`} className={`hr-reports__item${x.id === current ? " is-current" : ""}`} aria-current={x.id === current ? "page" : undefined}>
            <PixelAvatar persona={x.persona} size={32} decorative />
            <span>
              <span className="hr-reports__name">{x.persona.name}</span>
              <span className="mono muted hr-reports__meta">Semana de {x.week} · enviado</span>
            </span>
          </Link>
        ))}
      </nav>
      {detail}
    </div>
  );
}

function HrDetail({ persona, week, status, helps, prose }: { persona: Persona; week: string; status: string; helps: React.ReactNode; prose: string }) {
  return (
    <section className="card report" aria-label={`Relatório de ${persona.name}`}>
      <header className="report__who">
        <PixelAvatar persona={persona} size={40} decorative />
        <div>
          <p className="report__name">{persona.name}</p>
          <p className="mono muted report__week">
            Semana de {week} · {status}
          </p>
        </div>
      </header>
      {helps}
      <p className="report__summary">{prose}</p>
    </section>
  );
}

const noHelps = <p className="muted">Nenhuma ajuda a colegas registrada nesta semana.</p>;

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<{ pessoa?: string }> }) {
  const me = await requireAccess("relatorios");
  const scope = await teamScope(me);
  const TEAM = scope.people;
  const pick = (await searchParams).pessoa;
  const db = panelDb();

  if (db) {
    const ctx = await reportContext(db, me);
    const ids = scopeDbIds(scope);
    if (me.role === "hr") {
      // Só os relatórios das equipes que o RH acompanha.
      const { list, current } = await loadSentReports(db, ctx, pick, (id) => ids.has(id));
      const persona = (id: string, name: string) => panelPersona(ctx.people.find((p) => p.id === id) ?? { id, name });
      return (
        <>
          <h1 className="hero-title hero-title--page">{HR_TITLE}</h1>
          <p className="lead">{HR_LEAD}</p>
          <TeamPicker scope={scope} back="/relatorios" />
          {current ? (
            <HrReports
              items={list.map((x) => ({ id: x.personId, persona: persona(x.personId, x.name), week: x.week }))}
              current={current.entry.personId}
              detail={
                <HrDetail
                  persona={persona(current.entry.personId, current.entry.name)}
                  week={current.entry.week}
                  status={current.live.state === "sent_without_notice" ? "enviado sem aviso à pessoa" : "enviado ao RH"}
                  helps={current.live.report.helps.length > 0 ? <Helps r={current.live.report} /> : noHelps}
                  prose={current.live.text}
                />
              }
            />
          ) : (
            <p className="note muted">Nenhum relatório enviado por {scopeLabel(scope)} até agora. Cada um chega aqui três dias depois do aviso à pessoa.</p>
          )}
        </>
      );
    }

    const { live } = await loadMyReport(db, ctx);
    return (
      <>
        <h1 className="hero-title hero-title--page">{MY_TITLE}</h1>
        <p className="lead">{MY_LEAD}</p>
        <div className="profile-grid">
          {live ? (
            <LiveReportCard live={live} />
          ) : (
            <section className="card report" aria-labelledby="semana">
              <h2 id="semana" className="card__title">
                Semana atual
              </h2>
              <p className="muted">Seu relatório desta semana ainda não foi gerado. Ele sai no fim do seu último expediente da semana, e você recebe um aviso no Slack.</p>
            </section>
          )}
          <LiveHelpForm people={helpers(ctx).filter((p) => ids.has(p.id))} />
        </div>
      </>
    );
  }

  if (me.role === "hr") {
    // Uma pessoa por vez, abrindo pelas ajudas: nada de números lado a lado para comparar.
    // Só os relatórios das equipes que o RH acompanha.
    const sent = SENT_TO_HR.filter((x) => TEAM.some((p) => p.id === x));
    const id = sent.find((x) => x === pick) ?? sent[0];
    if (!id) {
      return (
        <>
          <h1 className="hero-title hero-title--page">{HR_TITLE}</h1>
          <TeamPicker scope={scope} back="/relatorios" />
          <p className="lead">Nenhum relatório enviado por {scopeLabel(scope)} nesta semana.</p>
        </>
      );
    }
    const p = findMember(id)!;
    const r = reportFor(id);
    return (
      <>
        <h1 className="hero-title hero-title--page">{HR_TITLE}</h1>
        <p className="lead">{HR_LEAD}</p>
        <TeamPicker scope={scope} back="/relatorios" />
        <HrReports
          items={sent.map((x) => ({ id: x, persona: findMember(x)!, week: reportFor(x).week }))}
          current={id}
          detail={<HrDetail persona={p} week={r.week} status="conferido e enviado" helps={r.helps.length > 0 ? <Helps r={r} /> : noHelps} prose={summaryLine(p.name, r)} />}
        />
      </>
    );
  }

  return (
    <>
      <h1 className="hero-title hero-title--page">{MY_TITLE}</h1>
      <p className="lead">{MY_LEAD}</p>
      <div className="profile-grid">
        <ReportCard name={me.name} report={reportFor(me.id)} />
        <HelpForm people={TEAM.filter((p) => p.id !== me.id && p.role !== "hr").map((p) => p.name)} />
      </div>
    </>
  );
}
