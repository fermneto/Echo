import { Skeleton, SkeletonPage } from "@/components/Skeleton";

const TILES = [1, 2, 3, 4, 5, 6];

/** Início carregando: quem está trabalhando e o mapa, com as mesmas classes da tela real. */
export default function LoadingInicio() {
  return (
    <SkeletonPage label="Carregando o início">
      <Skeleton width={378} height={29} style={{ marginBottom: "var(--space-xl)" }} />
      <Skeleton width="min(610px, 100%)" height={141} />
      <Skeleton width={180} height={20} style={{ marginTop: "var(--space-md)" }} />
      <ul className="crew-grid" role="list">
        {TILES.map((t) => (
          <li key={t}>
            <Skeleton width="100%" height={119} />
          </li>
        ))}
      </ul>
      <section className="section section--bleed">
        <Skeleton width="100%" height={420} />
      </section>
    </SkeletonPage>
  );
}
