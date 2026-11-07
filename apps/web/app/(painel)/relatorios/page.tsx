import { reportFor, SENT_TO_HR, summaryLine } from "@/lib/demo/reports";
import { findMember, TEAM } from "@/lib/demo/team";
import { requireAccess } from "@/lib/session";
import { PixelAvatar } from "@/components/PixelAvatar";
import { HelpForm, Helps, Metrics, ReportCard } from "./ReportCard";

export const metadata = { title: "Relatórios · Echo" };

export default async function RelatoriosPage() {
  const me = await requireAccess("relatorios");

  if (me.role === "hr") {
    return (
      <>
        <h1 className="hero-title hero-title--page">Relatórios enviados</h1>
        <p className="lead">O que cada pessoa conferiu e enviou nesta semana. Sem nota, sem ranking e sem acesso a notas ou cérebros.</p>
        <div className="report-grid">
          {SENT_TO_HR.map((id) => {
            const p = findMember(id)!;
            const r = reportFor(id);
            return (
              <section key={id} className="card report" aria-label={`Relatório de ${p.name}`}>
                <header className="report__who">
                  <PixelAvatar persona={p} size={40} decorative />
                  <div>
                    <p className="report__name">{p.name}</p>
                    <p className="mono muted report__week">Semana de {r.week} · enviado</p>
                  </div>
                </header>
                <p className="report__summary">{summaryLine(p.name, r)}</p>
                <Metrics r={r} />
                <Helps r={r} />
              </section>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="hero-title hero-title--page">Meus relatórios</h1>
      <p className="lead">O Echo resume a sua semana a partir do GitHub e do Linear, com crédito por cada ajuda. Você confere e comenta; três dias depois do aviso, ele segue ao RH.</p>
      <div className="profile-grid">
        <ReportCard name={me.name} report={reportFor(me.id)} />
        <HelpForm people={TEAM.filter((p) => p.id !== me.id && p.role !== "hr").map((p) => p.name)} />
      </div>
    </>
  );
}
