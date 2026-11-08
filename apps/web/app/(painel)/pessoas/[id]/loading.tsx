import Link from "next/link";
import { Skeleton, SkeletonPage } from "@/components/Skeleton";

function CardSkeleton({ title, rows }: { title: number; rows: number[] }) {
  return (
    <section className="card">
      <div className="card__title">
        <Skeleton width={title} height={20} />
      </div>
      {rows.map((w, i) => (
        <div key={i} className="field-row">
          <p className="field-row__k">
            <Skeleton width={72} height={11} />
          </p>
          <Skeleton width={`${w}%`} height={18} />
        </div>
      ))}
    </section>
  );
}

/** Ficha da pessoa carregando, com as mesmas classes da tela real. */
export default function LoadingPessoa() {
  return (
    <SkeletonPage label="Carregando a ficha da pessoa">
      <Link href="/equipe" className="back-link mono" tabIndex={-1}>
        ← Pessoas
      </Link>
      <div className="profile-grid">
        <div className="profile-col">
          <header className="profile-top">
            <figure className="profile-avatar">
              <Skeleton width={132} height={132} />
              <Skeleton width={140} height={15} />
            </figure>
            <div className="profile-top__text">
              <Skeleton width="min(320px, 100%)" height={47} />
              <Skeleton width={200} height={24} />
              <Skeleton width={260} height={28} />
            </div>
          </header>
          <CardSkeleton title={220} rows={[70, 85, 55]} />
          <CardSkeleton title={260} rows={[80, 60, 72, 45]} />
        </div>
        <div className="profile-col">
          <CardSkeleton title={150} rows={[75, 60]} />
          <CardSkeleton title={90} rows={[85, 50]} />
        </div>
      </div>
    </SkeletonPage>
  );
}
