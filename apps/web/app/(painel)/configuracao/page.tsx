import { panelDb } from "@/lib/db";
import { BUDGET, formatUsd } from "@/lib/demo/runs";
import { gainsOrgId } from "@/lib/gains";
import { slackMembers } from "@/lib/accounts-server";
import { teamsFor } from "@/lib/scope";
import { requireAccess } from "@/lib/session";
import { accessMatrix, CONNECTIONS, type ConnectionKind, connectionRows, costSteps, ROLE_LABEL, ROLES } from "@/lib/settings";
import { cadastrarPessoa } from "./actions";
import { CadastroPessoa } from "./CadastroPessoa";
import "./configuracao.css";

export const metadata = { title: "Configuração · Echo" };
export const dynamic = "force-dynamic";

type Loaded = { routes: Partial<Record<ConnectionKind, string | null>> | null; limitUsd: number; roles: Record<string, number> | null; orgName: string | null };

async function load(orgId: string): Promise<Loaded> {
  const db = panelDb();
  if (!db) return { routes: null, limitUsd: BUDGET.monthlyLimitUsd, roles: null, orgName: null };
  // Import tardio: as rotas das plataformas e o leitor da empresa, sem o restante do servidor.
  const [{ orgRoute }, { readOrgSettings }] = await Promise.all([import("@echo/connectors"), import("@echo/agents/execucoes")]);
  const id = gainsOrgId(orgId);
  const [routes, settings] = await Promise.all([
    Promise.all(CONNECTIONS.map(async (c) => [c.kind, await orgRoute(db, id, c.kind)] as const)).then(Object.fromEntries),
    readOrgSettings(db, id),
  ]);
  return { routes, limitUsd: settings?.monthlyLimitUsd ?? BUDGET.monthlyLimitUsd, roles: settings?.roles ?? null, orgName: settings?.name ?? null };
}

/** Configuração (etapa 15): conexões, limite de custo e quem vê o quê. Liderança e RH, só leitura. */
export default async function ConfiguracaoPage() {
  const persona = await requireAccess("configuracao");
  const canRegister = persona.role === "hr" || persona.role === "leader";
  const db = panelDb();
  const [{ routes, limitUsd, roles, orgName }, teams, members] = await Promise.all([
    load(persona.orgId),
    teamsFor(persona),
    canRegister && db ? slackMembers(db, gainsOrgId(persona.orgId)) : Promise.resolve(null),
  ]);
  const rows = connectionRows(routes);
  const on = rows.filter((r) => r.state === "on").length;

  return (
    <>
      <h1 className="hero-title hero-title--page">Configuração</h1>
      <p className="lead">
        {orgName ? `${orgName}. ` : ""}Conexões com as plataformas, limite de custo e o que cada papel vê. O Echo só escreve numa plataforma depois de uma aprovação registrada.
      </p>

      <section className="card settings-card" aria-labelledby="conexoes">
        <div className="settings-card__head">
          <h2 id="conexoes" className="card__title">
            Conexões
          </h2>
          <span className="mono muted">
            {routes === null ? "Sem banco neste ambiente" : `${on} de ${rows.length} ligadas`}
          </span>
        </div>
        <ul className="settings-conn" role="list">
          {rows.map((r) => (
            <li key={r.kind} className="settings-conn__row">
              <span className="settings-conn__name">{r.label}</span>
              <span className="muted settings-conn__use">{r.use}</span>
              <span className={`status-tag mono settings-conn__state is-${r.state}`}>
                <span className={`dot ${r.state === "on" ? "dot--on" : "dot--off"}`} aria-hidden="true" />
                {r.status}
              </span>
            </li>
          ))}
        </ul>
        <p className="card__foot">
          {routes === null
            ? "O painel não tem banco ligado (DATABASE_URL), então não há empresa para ligar às plataformas."
            : "Uma plataforma fica ligada quando a instalação aponta para a empresa. Tokens ficam cifrados e nunca aparecem aqui."}
        </p>
      </section>

      {persona.role === "hr" || persona.role === "leader" ? (
        <section className="card settings-card settings-grid" aria-labelledby="cadastro">
          <div className="settings-card__head">
            <h2 id="cadastro" className="card__title">
              Cadastrar pessoa
            </h2>
            <span className="mono muted">Foto e currículo ficam só neste pedido</span>
          </div>
          <CadastroPessoa action={cadastrarPessoa} teams={teams ?? []} slackMembers={members} />
          <p className="card__foot">
            O currículo é lido por um modelo aberto na nossa infraestrutura e vira cargo, habilidades, áreas e idiomas, sem dados pessoais. A foto vira traços de uma lista fechada (cabelo, pele, óculos, roupa), sem gênero, idade ou origem.
          </p>
        </section>
      ) : null}

      <div className="profile-grid settings-grid">
        <section className="card" aria-labelledby="acesso">
          <h2 id="acesso" className="card__title">
            Quem vê o quê
          </h2>
          <table className="runs-table settings-access">
            <thead>
              <tr>
                <th scope="col">Tela</th>
                {ROLES.map((r) => (
                  <th key={r} scope="col" className="num">
                    {ROLE_LABEL[r]}
                    {roles ? <span className="muted settings-access__n"> · {roles[r] ?? 0}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accessMatrix().map((a) => (
                <tr key={a.route}>
                  <th scope="row">{a.label}</th>
                  {ROLES.map((r) => (
                    <td key={r} className="num mono">
                      {a.roles[r] ? <span aria-label="vê">●</span> : <span className="muted" aria-label="não vê">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="card__foot">O RH nunca vê notas do dia, tarefas nem perguntas. Ninguém vê mensagens privadas nem tempo online.</p>
        </section>

        <section className="card" aria-labelledby="limite">
          <h2 id="limite" className="card__title">
            Limite de custo
          </h2>
          <p className="metric__v settings-limit__v">{formatUsd(limitUsd)}</p>
          <p className="mono muted settings-limit__k">por mês, para a empresa toda</p>
          <ol className="settings-steps" role="list">
            {costSteps(limitUsd).map((s) => (
              <li key={s.percent}>
                <span className="mono settings-steps__at">
                  {s.percent}% · {formatUsd(s.atUsd)}
                </span>
                <span>{s.what}</span>
              </li>
            ))}
          </ol>
          <p className="card__foot">Os degraus são regras fixas: o modelo não decide quando parar.{persona.role === "leader" ? " O gasto do mês está em Custo e execuções." : ""}</p>
        </section>
      </div>
    </>
  );
}
