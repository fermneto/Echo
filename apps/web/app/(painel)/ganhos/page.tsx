import { beforeAfter, gains, PERIOD } from "@/lib/demo/gains";
import { TEAM } from "@/lib/demo/team";
import { requireAccess } from "@/lib/session";

export const metadata = { title: "Ganhos · Echo" };

const fmt = (v: number, unit: string) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`;

export default async function GanhosPage() {
  await requireAccess("ganhos");
  const list = gains();
  const [hero, ...rest] = list;

  return (
    <>
      <h1 className="hero-title hero-title--page">Ganhos</h1>
      <p className="lead">
        Últimos {PERIOD.days} dias, só totais da empresa ({TEAM.filter((p) => p.role !== "hr").length} pessoas). Nenhum número aparece por pessoa, e cada um diz se é medido ou estimado.
      </p>

      <section className="card gains-hero" aria-labelledby="espera">
        <p className="mono muted gains__kind">{hero!.kind}</p>
        <h2 id="espera" className="card__title">
          {hero!.label}
        </h2>
        <p className="gains-hero__v">{hero!.value}</p>
        <p className="muted">{hero!.detail}. A resposta saiu quando a pessoa ainda estava fora, em vez de esperar a volta.</p>
      </section>

      <section className="card gains-compare" aria-labelledby="antes-depois">
        <h2 id="antes-depois" className="card__title">
          Revisões, antes e depois do Echo
        </h2>
        <div className="compare">
          {beforeAfter().map((b) => (
            <figure key={b.label} className="compare__item">
              <figcaption className="field-row__k mono">{b.label} · mediana</figcaption>
              {[
                ["Antes", b.before, "is-before"],
                ["Com o Echo", b.after, "is-after"],
              ].map(([k, v, cls]) => (
                <div key={k as string} className="compare__row">
                  <span className="mono muted compare__k">{k}</span>
                  <span className="compare__track">
                    <span className={`compare__bar ${cls}`} style={{ width: `${((v as number) / b.before) * 100}%` }} />
                  </span>
                  <span className="mono compare__v">{fmt(v as number, b.unit)}</span>
                </div>
              ))}
            </figure>
          ))}
        </div>
      </section>

      <ul className="gains-grid" role="list">
        {rest.map((g) => (
          <li key={g.label} className="card gain">
            <p className={`mono gains__kind${g.kind === "estimativa" ? " is-estimate" : ""}`}>{g.kind}</p>
            <p className="gain__label">{g.label}</p>
            <p className="gain__v">{g.value}</p>
            <p className="muted gain__detail">{g.detail}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
