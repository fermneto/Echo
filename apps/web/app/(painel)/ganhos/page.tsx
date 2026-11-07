import type { GainsResult } from "@echo/domain";
import { requireAccess } from "@/lib/session";
import { panelDb } from "@/lib/db";
import { baselineNote, gainsOrgId, gainsRows } from "@/lib/gains";
import { ROUTES } from "@/lib/access";

export const dynamic = "force-dynamic";

function Totals({ result }: { result: GainsResult }) {
  if (result.status !== "ok") {
    return <p className="note muted">Menos de {result.min} pessoas: sem totais, para não mostrar o resultado de alguém.</p>;
  }
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Métrica</th>
              <th scope="col">Últimos 30 dias</th>
              <th scope="col">Tipo</th>
            </tr>
          </thead>
          <tbody>
            {gainsRows(result).map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.value}</td>
                <td className="mono muted">{r.kind}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note muted">{baselineNote(result)}</p>
    </>
  );
}

/** Ganhos (etapa 13): só totais da empresa ou de equipes com ao menos 3 pessoas. RH e liderança. */
export default async function Page() {
  const persona = await requireAccess("ganhos");
  const db = panelDb();
  const header = (
    <>
      <h1 className="app-title">{ROUTES.ganhos.label}</h1>
      <p className="lead">Últimos 30 dias, só em totais da empresa ou de equipes com ao menos 3 pessoas. Antes e depois é comparação, não prova de causa.</p>
    </>
  );
  if (!db) {
    return (
      <>
        {header}
        <p className="muted">Sem banco ligado ao painel (DATABASE_URL): os totais aparecem quando ele estiver configurado.</p>
      </>
    );
  }
  // Import tardio: só o leitor dos Ganhos, sem o restante do servidor dos agentes.
  const { readGains } = await import("@echo/agents/ganhos");
  const view = await readGains(db, gainsOrgId(persona.orgId));
  return (
    <>
      {header}
      <section className="section">
        <h2 className="section__title label-caps">Empresa</h2>
        <div className="module">
          <Totals result={view.org} />
        </div>
      </section>
      {view.teams.map((t) => (
        <section className="section" key={t.id}>
          <h2 className="section__title label-caps">Equipe {t.name}</h2>
          <div className="module">
            <Totals result={t.result} />
          </div>
        </section>
      ))}
    </>
  );
}
