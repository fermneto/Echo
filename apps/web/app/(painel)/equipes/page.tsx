import { addDays, type HrOverview, type HrTeam, type HrWeek, localDate, recentWeeks } from "@echo/domain";
import { TeamPicker } from "@/components/TeamPicker";
import { panelDb } from "@/lib/db";
import { demoHrOverview } from "@/lib/demo/hr";
import { gainsOrgId } from "@/lib/gains";
import { scopeLabel, teamScope } from "@/lib/scope";
import { requireAccess } from "@/lib/session";
import { type TrendTeam, TeamTrends, type TrendWeek } from "./TeamTrends";

export const metadata = { title: "Visão das equipes · Echo" };
export const dynamic = "force-dynamic";

const dm = (date: string) => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
/** "26/10 a 30/10": segunda a sexta da semana. */
const weekRange = (monday: string) => `${dm(monday)} a ${dm(addDays(monday, 4))}`;

type Ok = Extract<HrTeam, { status: "ok" }>;

function Tile({ label, value, before, detail }: { label: string; value: string; before?: string; detail?: string }) {
  return (
    <li className="card hr-tile">
      <p className="hr-tile__label">{label}</p>
      <p className="hr-tile__v">{value}</p>
      {before ? <p className="mono muted hr-tile__before">semana anterior: {before}</p> : null}
      {detail ? <p className="mono muted hr-tile__before">{detail}</p> : null}
    </li>
  );
}

function TeamCard({ team, focus, timeZone }: { team: HrTeam; focus: string; timeZone: string }) {
  if (team.status === "too_small") {
    return (
      <li className="card hr-team">
        <h3 className="hr-team__name">{team.name}</h3>
        <p className="muted hr-team__small">Menos de {team.min} pessoas: sem totais, para não mostrar o resultado de alguém.</p>
      </li>
    );
  }
  const w = team.weeks.find((x) => x.week === focus)!;
  const rows: [string, string][] = [
    ["Relatórios enviados", `${w.sent} de ${team.people}`],
    ["Entregas", String(w.deliveries)],
    ["Revisões", String(w.reviews)],
    ["Ajudas entre colegas", String(w.helps)],
    ["Respostas dos gêmeos", String(w.twins)],
  ];
  return (
    <li className="card hr-team">
      <header className="hr-team__head">
        <h3 className="hr-team__name">{team.name}</h3>
        <span className="mono muted">{team.people} pessoas</span>
      </header>
      <dl className="hr-team__rows">
        {rows.map(([k, v]) => (
          <div key={k} className="hr-team__row">
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="hr-team__away">
        <span className="hr-team__away-k">Fora agora</span>
        {team.away.length === 0 ? (
          <span className="muted">ninguém</span>
        ) : (
          team.away.map((a) => (
            <span key={`${a.name}${a.until.getTime()}`} className="hr-team__away-who">
              <span className="hr-dot" aria-hidden /> {a.name} <span className="mono muted">volta em {dm(localDate(a.until, timeZone))}</span>
            </span>
          ))
        )}
      </p>
    </li>
  );
}

/** "3 concluídas · 2 em revisão · 4 em andamento · 5 a fazer": contagem por estado, em texto. */
function stagesText(p: Ok["progress"]): string {
  const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;
  return [n(p.done, "concluída", "concluídas"), n(p.review, "em revisão", "em revisão"), n(p.doing, "em andamento", "em andamento"), n(p.todo, "a fazer", "a fazer")].join(" · ");
}

/**
 * Trabalho de uma equipe agora, só em contagem de tarefas por estado. Sem percentual e sem barra normalizada:
 * nada que reduza a equipe a um número que dê para pôr ao lado do de outra.
 */
function ProgressCard({ team }: { team: Ok }) {
  const p = team.progress;
  return (
    <li className="card hr-progress">
      <header className="hr-team__head">
        <h3 className="hr-team__name">{team.name}</h3>
        <span className="mono muted">{team.people} pessoas</span>
      </header>
      {p.total === 0 ? (
        <p className="muted hr-team__small">Nenhuma tarefa aberta nem concluída nas últimas 2 semanas.</p>
      ) : (
        <p className="hr-progress__stages">{stagesText(p)}</p>
      )}
    </li>
  );
}

function trends(view: HrOverview, current: string): { weeks: TrendWeek[]; teams: TrendTeam[] } {
  const weeks = view.total.map((w) => ({ week: w.week, label: `Semana de ${weekRange(w.monday)}`, short: dm(w.monday), open: w.week === current }));
  const teams = view.teams
    .filter((t): t is Ok => t.status === "ok")
    .map((t) => ({
      id: t.id,
      name: t.name,
      people: t.people,
      sent: t.weeks.map((w) => w.sent),
      values: { deliveries: t.weeks.map((w) => w.deliveries), reviews: t.weeks.map((w) => w.reviews), helps: t.weeks.map((w) => w.helps), twins: t.weeks.map((w) => w.twins) },
    }));
  return { weeks, teams };
}

/** Visão das equipes do RH: totais por equipe, a partir dos relatórios enviados. Nada por pessoa. */
export default async function EquipesPage() {
  const me = await requireAccess("equipes");
  const scope = await teamScope(me);
  const db = panelDb();
  const now = new Date();
  const tz = me.timezone || "UTC";
  const view = db ? await (await import("@echo/agents/rh")).readHrOverview(db, gainsOrgId(me.orgId), scope.visible, now, tz) : demoHrOverview(scope.visible, now);
  const current = recentWeeks(localDate(now, tz), 1)[0]!;

  const ok = view.teams.filter((t): t is Ok => t.status === "ok");
  const fi = view.total.findIndex((w) => w.week === view.focus);
  const f: HrWeek | undefined = view.total[fi];
  const prev: HrWeek | undefined = fi > 0 ? view.total[fi - 1] : undefined;
  const people = ok.reduce((s, t) => s + t.people, 0);
  const away = ok.reduce((s, t) => s + t.away.length, 0);
  const t = trends(view, current);

  return (
    <>
      <h1 className="hero-title hero-title--page">Visão das equipes</h1>
      <p className="lead">Progresso das tarefas de cada equipe e entregas, revisões, ajudas e respostas dos gêmeos somadas a partir dos relatórios já enviados. Sem número por pessoa, sem ranking e sem comparar equipes: cada uma aparece frente à própria história.</p>
      <TeamPicker scope={scope} back="/equipes" />

      {view.teams.length === 0 ? (
        <p className="note muted">Nenhuma equipe acompanhada. Escolha acima as equipes que quer ver.</p>
      ) : ok.length === 0 ? (
        <p className="note muted">Você vê {scopeLabel(scope)}, e cada equipe tem menos de 3 pessoas: sem totais, para não mostrar o resultado de alguém.</p>
      ) : (
        <>
          {f ? (
            <section className="section" aria-labelledby="hr-semana">
              <h2 id="hr-semana" className="section__title label-caps">
                Semana de {weekRange(f.monday)}
              </h2>
              <ul className="hr-tiles" role="list">
                <Tile label="Entregas" value={String(f.deliveries)} {...(prev ? { before: String(prev.deliveries) } : {})} />
                <Tile label="Revisões" value={String(f.reviews)} {...(prev ? { before: String(prev.reviews) } : {})} />
                <Tile label="Ajudas entre colegas" value={String(f.helps)} {...(prev ? { before: String(prev.helps) } : {})} />
                <Tile label="Respostas dos gêmeos" value={String(f.twins)} {...(prev ? { before: String(prev.twins) } : {})} />
                <Tile label="Relatórios enviados" value={`${f.sent} de ${people}`} detail={away ? `${away} ${away === 1 ? "pessoa fora" : "pessoas fora"} agora` : "ninguém fora agora"} />
              </ul>
            </section>
          ) : null}

          <section className="section" aria-labelledby="hr-progresso">
            <h2 id="hr-progresso" className="section__title label-caps">
              Trabalho de cada equipe agora
            </h2>
            <p className="muted hr-progress__lead">Tarefas abertas no Linear e no Jira e as concluídas nas últimas 2 semanas, contadas por estado. Sem percentual: o tamanho do backlog não diz se uma equipe vai bem.</p>
            <ul className="hr-teams" role="list">
              {ok.map((team) => (
                <ProgressCard key={team.id} team={team} />
              ))}
            </ul>
          </section>

          <TeamTrends weeks={t.weeks} focus={view.focus} teams={t.teams} />

          <section className="section" aria-labelledby="hr-equipes">
            <h2 id="hr-equipes" className="section__title label-caps">
              Cada equipe, na semana de {f ? weekRange(f.monday) : ""}
            </h2>
            <ul className="hr-teams" role="list">
              {view.teams.map((team) => (
                <TeamCard key={team.id} team={team} focus={view.focus} timeZone={tz} />
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}
