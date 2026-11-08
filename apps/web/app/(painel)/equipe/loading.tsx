import { Skeleton, SkeletonPage } from "@/components/Skeleton";

const ROWS = [168, 124, 150, 112, 140, 128];

/** Lista de pessoas carregando, com as mesmas classes da tela real. */
export default function LoadingEquipe() {
  return (
    <SkeletonPage label="Carregando as pessoas da equipe">
      <h1 className="hero-title hero-title--page">Pessoas</h1>
      <p className="lead">
        <Skeleton width="min(620px, 100%)" height={20} />
        <Skeleton width="min(420px, 100%)" height={20} style={{ marginTop: 12 }} />
      </p>
      <Skeleton width="100%" height={44} style={{ marginTop: "var(--space-xl)" }} />
      <ul className="people-list" role="list">
        {ROWS.map((w) => (
          <li key={w} className="people-row">
            <Skeleton width={40} height={40} />
            <div className="people-row__who">
              <Skeleton width={w} height={18} />
              <Skeleton width={w - 30} height={12} style={{ marginTop: 8 }} />
            </div>
            <div className="people-row__cell people-row__cell--now">
              <span className="people-row__k mono">Agora</span>
              <Skeleton width={150} />
            </div>
            <div className="people-row__cell people-row__cell--time">
              <span className="people-row__k mono">Hora local</span>
              <Skeleton width={72} />
            </div>
            <div className="people-row__actions">
              <Skeleton width={92} height={36} />
            </div>
          </li>
        ))}
      </ul>
    </SkeletonPage>
  );
}
