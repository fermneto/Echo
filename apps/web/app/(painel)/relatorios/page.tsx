import Link from "next/link";
import { reportFor, SENT_TO_HR, summaryLine } from "@/lib/demo/reports";
import { findMember, TEAM } from "@/lib/demo/team";
import { requireAccess } from "@/lib/session";
import { PixelAvatar } from "@/components/PixelAvatar";
import { HelpForm, Helps, ReportCard } from "./ReportCard";

export const metadata = { title: "Relatórios · Echo" };

export default async function RelatoriosPage({ searchParams }: { searchParams: Promise<{ pessoa?: string }> }) {
  const me = await requireAccess("relatorios");

  if (me.role === "hr") {
    // Uma pessoa por vez, abrindo pelas ajudas: nada de números lado a lado para comparar.
    const pick = (await searchParams).pessoa;
    const id = SENT_TO_HR.find((x) => x === pick) ?? SENT_TO_HR[0];
    const p = findMember(id)!;
    const r = reportFor(id);
    return (
      <>
        <h1 className="hero-title hero-title--page">Relatórios enviados</h1>
        <p className="lead">O que cada pessoa conferiu e enviou nesta semana. Sem nota, sem ranking e sem acesso às notas de ninguém.</p>
        <div className="hr-reports">
          <nav className="hr-reports__list" aria-label="Pessoas com relatório enviado">
            {SENT_TO_HR.map((x) => {
              const who = findMember(x)!;
              return (
                <Link key={x} href={`/relatorios?pessoa=${x}`} className={`hr-reports__item${x === id ? " is-current" : ""}`} aria-current={x === id ? "page" : undefined}>
                  <PixelAvatar persona={who} size={32} decorative />
                  <span>
                    <span className="hr-reports__name">{who.name}</span>
                    <span className="mono muted hr-reports__meta">Semana de {reportFor(x).week} · enviado</span>
                  </span>
                </Link>
              );
            })}
          </nav>
          <section className="card report" aria-label={`Relatório de ${p.name}`}>
            <header className="report__who">
              <PixelAvatar persona={p} size={40} decorative />
              <div>
                <p className="report__name">{p.name}</p>
                <p className="mono muted report__week">Semana de {r.week} · conferido e enviado</p>
              </div>
            </header>
            {r.helps.length > 0 ? <Helps r={r} /> : <p className="muted">Nenhuma ajuda a colegas registrada nesta semana.</p>}
            <p className="report__summary">{summaryLine(p.name, r)}</p>
          </section>
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
