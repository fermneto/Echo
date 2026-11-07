import type { ReactNode } from "react";

/** Janela com cabeçalho, corpo e rodapé opcional. */
export function ProductWindow({ title, footer, example = false, children }: { title: string; footer?: ReactNode; example?: boolean; children: ReactNode }) {
  return (
    <section className="window" aria-label={title}>
      <header className="window__head">
        <span>{title}</span>
        {example && <span className="pill-example mono">Exemplo</span>}
      </header>
      <div className="window__body">{children}</div>
      {footer && <footer className="window__foot">{footer}</footer>}
    </section>
  );
}
