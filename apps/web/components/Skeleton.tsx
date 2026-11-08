import type { CSSProperties, ReactNode } from "react";

/** Bloco no lugar de um dado que ainda não chegou. O tamanho vem da tela real, para nada pular ao carregar. */
export function Skeleton({ width, height = 14, style }: { width: number | string; height?: number | string; style?: CSSProperties }) {
  return <span className="skeleton" style={{ width, height, ...style }} />;
}

/** Tela carregando: quem usa leitor de tela ouve o que está vindo, sem ler cada bloco. */
export function SkeletonPage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="skeleton-page" role="status" aria-busy="true" aria-label={label}>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}
