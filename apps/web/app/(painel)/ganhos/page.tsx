import { beforeAfter, gains, PERIOD } from "@/lib/demo/gains";
import { panelDb } from "@/lib/db";
import { baselineNote, type GainsCompare, gainsCompare, gainsOrgId, gainsRows } from "@/lib/gains";
import { requireAccess } from "@/lib/session";

export const metadata = { title: "Ganhos · Echo" };
export const dynamic = "force-dynamic";

type Item = { label: string; value: string; detail?: string; kind: "estimativa" | "medido" };
type Board = { hero?: Item; compare: GainsCompare[]; rest: Item[]; note?: string };

const fmt = (v: number, unit: string) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`;

function Compare({ items }: { items: GainsCompare[] }) {
  if (items.length === 0) return null;
  return (
    <section className="card gains-compare" aria-labelledby="antes-depois">
      <h2 id="antes-depois" className="card__title">
        Revisões, antes e depois do Echo
      </h2>
      <div className="compare">
        {items.map((b) => {
          const max = Math.max(b.before, b.after) || 1;
          return (
            <figure key={b.label} className="compare__item">
              <figcaption className="field-row__k mono">{b.label} · mediana</figcaption>
              {(
                [
                  ["Antes", b.before, "is-before"],
                  ["Com o Echo", b.after, "is-after"],
                ] as const
              ).map(([k, v, cls]) => (
                <div key={k} className="compare__row">
                  <span className="mono muted compare__k">{k}</span>
                  <span className="compare__track">
                    <span className={`compare__bar ${cls}`} style={{ width: `${(v / max) * 100}%` }} />
                  </span>
                  <span className="mono compare__v">{fmt(v, b.unit)}</span>
                </div>
              ))}
            </figure>
          );
        })}
      </div>
    </section>
  );
}

function Grid({ items }: { items: Item[] }) {
  return (
    <ul className="gains-grid" role="list">
      {items.map((g) => (
        <li key={g.label} className="card gain">
          <p className={`mono gains__kind${g.kind === "estimativa" ? " is-estimate" : ""}`}>{g.kind}</p>
          <p className="gain__label">{g.label}</p>
          <p className="gain__v">{g.value}</p>
          {g.detail ? <p className="muted gain__detail">{g.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function GainsBoard({ board, id }: { board: Board; id: string }) {
  const { hero } = board;
  return (
    <>
      {hero ? (
        <section className="card gains-hero" aria-labelledby={`${id}-espera`}>
          <p className="mono muted gains__kind">{hero.kind}</p>
          <h2 id={`${id}-espera`} className="card__title">
            {hero.label}
          </h2>
          <p className="gains-hero__v">{hero.value}</p>
          <p className="muted">
            {hero.detail ? `${hero.detail}. ` : ""}A resposta saiu quando a pessoa ainda estava fora, em vez de esperar a volta.
          </p>
        </section>
      ) : null}
      <Compare items={board.compare} />
      <Grid items={board.rest} />
      {board.note ? <p className="note muted gains__note">{board.note}</p> : null}
    </>
  );
}

/** Dados de demonstração do #32, usados só quando o painel não tem banco. */
function demoBoard(): Board {
  const [hero, ...rest] = gains();
  return { hero, compare: beforeAfter(), rest };
}

/** Ganhos (etapa 13): só totais da empresa ou de equipes com ao menos 3 pessoas. RH e liderança. */
export default async function GanhosPage() {
  const persona = await requireAccess("ganhos");
  const db = panelDb();

  if (!db) {
    return (
      <>
        <h1 className="hero-title hero-title--page">Ganhos</h1>
        <p className="lead">Últimos {PERIOD.days} dias, só totais da empresa. Dados de demonstração: o painel ainda não tem banco ligado (DATABASE_URL).</p>
        <GainsBoard board={demoBoard()} id="demo" />
      </>
    );
  }

  // Import tardio: só o leitor dos Ganhos, sem o restante do servidor dos agentes.
  const { readGains } = await import("@echo/agents/ganhos");
  const view = await readGains(db, gainsOrgId(persona.orgId));
  const board = (r: typeof view.org): Board => {
    const [hero, ...rest] = gainsRows(r);
    return { hero, compare: gainsCompare(r), rest, note: baselineNote(r) };
  };

  return (
    <>
      <h1 className="hero-title hero-title--page">Ganhos</h1>
      <p className="lead">
        Últimos 30 dias, só totais da empresa ({view.org.people} pessoas) ou de equipes com ao menos 3 pessoas. Nenhum número aparece por pessoa, e cada um diz se é medido ou estimado. Antes e depois é comparação, não prova de causa.
      </p>
      {view.org.status === "ok" ? <GainsBoard board={board(view.org)} id="org" /> : <p className="note muted">Menos de {view.org.min} pessoas: sem totais, para não mostrar o resultado de alguém.</p>}
      {view.teams.map((t) => (
        <section className="section" key={t.id}>
          <h2 className="section__title label-caps">Equipe {t.name}</h2>
          {t.result.status === "ok" ? <Grid items={gainsRows(t.result)} /> : <p className="note muted">Menos de {t.result.min} pessoas: sem totais, para não mostrar o resultado de alguém.</p>}
        </section>
      ))}
    </>
  );
}
