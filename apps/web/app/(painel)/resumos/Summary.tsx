import type { ArtifactBlock, Component, DayFacts, Fact } from "@echo/artifacts";

/**
 * Biblioteca fechada de componentes do resumo do dia. O rótulo de cada bloco é fixo (código); o título e a
 * frase do modelo vêm validados. Tudo que tem número, nome, chave ou branch sai dos fatos, montados por regra.
 */
const LABELS: Partial<Record<Component, { label: string; tone: "twin" | "wait" | "on" | "plain" }>> = {
  destaque: { label: "Onde parou", tone: "twin" },
  lista_pendencias: { label: "O que travou", tone: "wait" },
  cartao_tarefa: { label: "Tarefas abertas", tone: "plain" },
  cartao_pr: { label: "Pull requests", tone: "plain" },
  linha_do_dia: { label: "Atividade do dia", tone: "on" },
  quadro_liberado_reservado: { label: "Liberado e reservado", tone: "plain" },
};

export function SummaryBlocks({ blocks, day }: { blocks: ArtifactBlock[]; day: DayFacts }) {
  const byId = new Map(day.facts.map((f) => [f.id, f]));
  return (
    <div className="summary__blocks">
      {blocks.map((b, i) => {
        const facts = b.factIds.map((id) => byId.get(id)).filter((f): f is Fact => !!f);
        if (!facts.length) return null;
        return <Block key={`${b.component}-${i}`} block={b} facts={facts} />;
      })}
    </div>
  );
}

function Head({ block, count }: { block: ArtifactBlock; count?: number }) {
  const l = LABELS[block.component];
  return (
    <header className="summary__head">
      {l && (
        <p className={`summary__eyebrow summary__eyebrow--${l.tone}`}>
          <span className="summary__eyebrow-dot" aria-hidden="true" />
          {l.label}
          {count !== undefined && <span className="summary__count num">{count}</span>}
        </p>
      )}
      {block.title && <h2 className="summary__title">{block.title}</h2>}
      {block.text && <p className="summary__text">{block.text}</p>}
    </header>
  );
}

function Block({ block, facts }: { block: ArtifactBlock; facts: Fact[] }) {
  switch (block.component) {
    case "destaque":
      return (
        <section className="summary__block summary__block--hero">
          <Head block={block} />
          <ul className="summary__hero-list">
            {facts.map((f) => (
              <li key={f.id}>{f.label}</li>
            ))}
          </ul>
        </section>
      );
    case "lista_pendencias":
      return (
        <section className="summary__block summary__block--wait">
          <Head block={block} count={facts.length} />
          <ul className="summary__rows">
            {facts.map((f) => (
              <li key={f.id} className="summary__row summary__row--wait">
                {f.label}
              </li>
            ))}
          </ul>
        </section>
      );
    case "cartao_tarefa":
    case "cartao_pr":
      return (
        <section className="summary__block summary__block--wide">
          <Head block={block} count={facts.length} />
          <div className="summary__cards">
            {facts.map((f) => (
              <article key={f.id} className="summary__card">
                <div className="summary__card-top">
                  <span className="mono summary__ref">{f.detail}</span>
                  {f.status && <span className={`summary__status summary__status--${statusTone(f.status)}`}>{f.status}</span>}
                </div>
                <p className="summary__card-title">{f.label}</p>
              </article>
            ))}
          </div>
        </section>
      );
    case "linha_do_dia":
      return (
        <section className="summary__block">
          <Head block={block} />
          <div className="summary__stats">
            {facts.map((f) => (
              <div key={f.id} className="summary__stat">
                <span className="summary__stat-v num">{f.value ?? "—"}</span>
                <span className="summary__stat-k">{f.label}</span>
              </div>
            ))}
          </div>
        </section>
      );
    case "quadro_liberado_reservado": {
      const col = (kind: Fact["kind"], label: string) => {
        const items = facts.filter((f) => f.kind === kind);
        return (
          <div className="summary__col">
            <h3 className="summary__col-title">{label}</h3>
            {items.length ? (
              <ul className="summary__rows">
                {items.map((f) => (
                  <li key={f.id} className="summary__row summary__mark">
                    <span className="mono summary__branch">{f.label}</span>
                    {f.detail && <span className="summary__mark-detail">{f.detail}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="summary__none">Nada declarado.</p>
            )}
          </div>
        );
      };
      return (
        <section className="summary__block summary__block--wide">
          <Head block={block} />
          <div className="summary__board">
            {col("liberado", "Liberado")}
            {col("reservado", "Reservado")}
          </div>
          <p className="summary__foot">Só a própria pessoa declara o que está liberado ou reservado.</p>
        </section>
      );
    }
    default:
      return null;
  }
}

function statusTone(status: string): "on" | "wait" | "twin" {
  if (status === "em revisão" || status === "aberto") return "twin";
  if (status === "rascunho" || status === "a fazer" || status === "no backlog") return "wait";
  return "on";
}
