import type { ReactNode } from "react";

/** Tela de erro ou de página inexistente: diz o que houve e oferece o próximo passo. */
export function StatusScreen({ title, text, code, children }: { title: string; text: string; code?: string | undefined; children: ReactNode }) {
  return (
    <section className="status-screen">
      <h1 className="hero-title hero-title--page">{title}</h1>
      <p className="lead">{text}</p>
      <div className="status-screen__actions">{children}</div>
      {code && <p className="status-screen__code mono">Código do erro: {code}</p>}
    </section>
  );
}
