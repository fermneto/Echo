import Link from "next/link";

/** Convite principal: ao passar o mouse, um círculo preenche o botão, e o texto volta com a seta. */
export function StartButton({ small = false }: { small?: boolean }) {
  return (
    <Link href="/entrar" className={`lp-btn lp-btn--paper lp-start${small ? " lp-btn--sm" : ""}`}>
      <span className="lp-start__dot" aria-hidden="true" />
      <span className="lp-start__label">Começar</span>
      <span className="lp-start__hover" aria-hidden="true">
        Começar
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </Link>
  );
}
