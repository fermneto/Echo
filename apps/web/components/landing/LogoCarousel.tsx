"use client";

import { useEffect, useState } from "react";

/**
 * Carrossel de logos em colunas: cada coluna troca de logo a cada 2 s, com o novo entrando
 * de baixo e saindo do desfoque, e o anterior saindo para cima. Todas as colunas trocam
 * juntas, no mesmo relógio. Com movimento reduzido, mostra todos os logos parados.
 */

export type CarouselLogo = { name: string; status: "hoje" | "em breve"; path?: string };

const CYCLE_MS = 2000;
const EXIT_MS = 300;

/**
 * Distribui em colunas por rodízio, sem sorteio e sem repetir: a primeira leva é sempre a
 * mesma. Colunas podem ter tamanhos diferentes; cada uma dá a volta no próprio tamanho.
 */
export function distribute<T>(items: readonly T[], columns: number): T[][] {
  const cols: T[][] = Array.from({ length: columns }, () => []);
  items.forEach((item, i) => cols[i % columns]!.push(item));
  return cols.filter((c) => c.length > 0);
}

function Logo({ logo }: { logo: CarouselLogo }) {
  return (
    <span className="logo-slot__logo">
      {logo.path ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={logo.path} fill="currentColor" />
        </svg>
      ) : (
        <span className="logo-slot__word">{logo.name}</span>
      )}
      <span className="logo-slot__name">
        {/* Sem ícone, o nome já está escrito acima. */}
        {logo.path && logo.name}
      </span>
    </span>
  );
}

/** Uma coluna mostra o logo do passo atual; durante a troca, o anterior sai por cima. */
function Column({ logos, step, swapping, index }: { logos: CarouselLogo[]; step: number; swapping: boolean; index: number }) {
  const current = step % logos.length;
  const previous = (step - 1 + logos.length) % logos.length;
  return (
    <div className="logo-slot" style={{ animationDelay: `${index * 0.1}s` }}>
      {swapping && step > 0 && (
        <div key={`out-${step}`} className="logo-slot__item is-leaving">
          <Logo logo={logos[previous]!} />
        </div>
      )}
      <div key={`in-${step}`} className="logo-slot__item is-entering">
        <Logo logo={logos[current]!} />
      </div>
    </div>
  );
}

export function LogoCarousel({ logos, columns = 4 }: { logos: readonly CarouselLogo[]; columns?: number }) {
  const [still, setStill] = useState(false);
  // Um relógio só para todas as colunas: trocam juntas.
  const [step, setStep] = useState(0);
  const [swapping, setSwapping] = useState(false);

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (still) return;
    let end = 0;
    const interval = window.setInterval(() => {
      setStep((s) => s + 1);
      setSwapping(true);
      window.clearTimeout(end);
      end = window.setTimeout(() => setSwapping(false), EXIT_MS);
    }, CYCLE_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(end);
    };
  }, [still]);

  if (still) {
    return (
      <ul className="logo-grid" role="list">
        {logos.map((l) => (
          <li key={l.name}>
            <Logo logo={l} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="logo-carousel" aria-hidden="true">
      {distribute(logos, columns).map((col, i) => (
        <Column key={i} logos={col} step={step} swapping={swapping} index={i} />
      ))}
    </div>
  );
}
