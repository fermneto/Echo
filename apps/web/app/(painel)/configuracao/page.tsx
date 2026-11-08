import { panelDb } from "@/lib/db";
import { BUDGET, formatUsd } from "@/lib/demo/runs";
import { gainsOrgId } from "@/lib/gains";
import { canRegisterPeople, linkablePlatforms } from "@/lib/access";
import { slackDirectory } from "@/lib/accounts-server";
import { membersOf, slackDirectoryFor } from "@/lib/slack-directory";
import { teamsFor } from "@/lib/scope";
import { isDemoSession, requireAccess } from "@/lib/session";
import { accessMatrix, CONNECTIONS, type ConnectionKind, connectionRows, costSteps, ROLE_LABEL, ROLES } from "@/lib/settings";
import { editableVideoChannels, type VideoChannelRow } from "@/lib/video-channel";
import { cadastrarPessoa, salvarCanalVideo } from "./actions";
import { CadastroPessoa } from "./CadastroPessoa";
import { CanalVideo } from "./CanalVideo";
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

/** Canais do vídeo e sugestões (canais onde o Echo já respondeu). Falha na leitura: a seção some, a página segue. */
async function loadVideoChannels(db: NonNullable<ReturnType<typeof panelDb>>, orgId: string) {
  const { readVideoChannels } = await import("@echo/agents/server");
  return readVideoChannels(db, orgId).catch(() => null);
}

/** Configuração (etapa 15): conexões, cadastro, canal do vídeo da semana, limite de custo e quem vê o quê. Liderança e RH. */
export default async function ConfiguracaoPage() {
  const persona = await requireAccess("configuracao");
  const canRegister = canRegisterPeople(persona.role);
  const canSetVideo = persona.role === "hr" || persona.role === "leader";
  const db = panelDb();
  // Só o RH cadastra; ele liga Slack, GitHub e Linear da pessoa nova.
  const platforms = canRegister ? linkablePlatforms(persona, { id: "", role: "member", teamId: persona.teamId }) : [];
  const [{ routes, limitUsd, roles, orgName }, teams, slack, channels] = await Promise.all([
    load(persona.orgId),
    teamsFor(persona),
    // Na demonstração, o Slack real nunca é lido (nem users.list).
    slackDirectoryFor({ demo: isDemoSession(persona), canLinkSlack: Boolean(db) && platforms.includes("slack"), read: () => slackDirectory(db!, gainsOrgId(persona.orgId)) }),
    canSetVideo && db ? loadVideoChannels(db, gainsOrgId(persona.orgId)) : Promise.resolve(null),
  ]);
  const channelRows: VideoChannelRow[] = channels ? editableVideoChannels(persona, channels) : [];
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

      {canRegister ? (
        <section className="card settings-card settings-grid" aria-labelledby="cadastro">
          <div className="settings-card__head">
            <h2 id="cadastro" className="card__title">
              Cadastrar pessoa
            </h2>
            <span className="mono muted">Foto e currículo ficam só neste pedido</span>
          </div>
          <CadastroPessoa action={cadastrarPessoa} teams={teams ?? []} slackMembers={membersOf(slack)} platforms={platforms} slackFailed={slack.status === "failed"} />
          <p className="card__foot">
            O currículo é lido pelo Claude Haiku, pela API da Anthropic, e vira cargo, habilidades, áreas e idiomas, sem dados pessoais; o texto não é guardado. A foto vira traços de uma lista fechada (cabelo, pele, óculos, roupa), sem gênero, idade ou origem.
          </p>
        </section>
      ) : null}

      {channelRows.length ? (
        <section className="card settings-card settings-grid" aria-labelledby="canal-video">
          <div className="settings-card__head">
            <h2 id="canal-video" className="card__title">
              Canal do vídeo da semana
            </h2>
            <span className="mono muted">Uma postagem por vídeo, no Slack</span>
          </div>
          <CanalVideo action={salvarCanalVideo} rows={channelRows} suggestions={channels?.suggestions ?? []} />
          <p className="card__foot">
            Quando o vídeo da semana fica pronto, o Echo posta no canal da equipe (sem canal, no da empresa) para a equipe assistir e comentar na thread. Sem nenhum canal, o vídeo fica só em Relatórios. Cole o id do canal público (C…) e convide o Echo para o canal: ele não entra sozinho.
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
