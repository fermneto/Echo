"use client";

import { useEffect, useState } from "react";

/**
 * Carrossel de logos em colunas: cada coluna troca de logo a cada 2 s, com o novo entrando
 * de baixo e saindo do desfoque, e o anterior saindo para cima. As colunas trocam em
 * momentos levemente diferentes. Com movimento reduzido, mostra todos os logos parados.
 */

export type CarouselLogo = { name: string; status: "hoje" | "em breve"; path?: string };

const CYCLE_MS = 2000;
const EXIT_MS = 300;

/** Distribui em colunas por rodízio, sem sorteio: a primeira leva é sempre a mesma. */
export function distribute<T>(items: readonly T[], columns: number): T[][] {
  const cols: T[][] = Array.from({ length: columns }, () => []);
  items.forEach((item, i) => cols[i % columns]!.push(item));
  const max = Math.max(...cols.map((c) => c.length));
  cols.forEach((c, ci) => {
    let k = ci;
    while (c.length < max) c.push(items[k++ % items.length]!);
  });
  return cols;
}

function Logo({ logo }: { logo: CarouselLogo }) {
  return (
    <span className={`logo-slot__logo${logo.status === "hoje" ? " is-live" : ""}`}>
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
        {logo.status === "em breve" && <span className="logo-slot__soon">em breve</span>}
      </span>
    </span>
  );
}

function Column({ logos, index }: { logos: CarouselLogo[]; index: number }) {
  const [current, setCurrent] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);

  useEffect(() => {
    let interval = 0;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        setCurrent((c) => {
          setLeaving(c);
          return (c + 1) % logos.length;
        });
      }, CYCLE_MS);
    }, index * 200);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [logos.length, index]);

  useEffect(() => {
    if (leaving === null) return;
    const t = window.setTimeout(() => setLeaving(null), EXIT_MS);
    return () => window.clearTimeout(t);
  }, [leaving]);

  return (
    <div className="logo-slot" style={{ animationDelay: `${index * 0.1}s` }}>
      {leaving !== null && (
        <div key={`out-${leaving}`} className="logo-slot__item is-leaving">
          <Logo logo={logos[leaving]!} />
        </div>
      )}
      <div key={`in-${current}`} className="logo-slot__item is-entering">
        <Logo logo={logos[current]!} />
      </div>
    </div>
  );
}

export function LogoCarousel({ logos, columns = 4 }: { logos: readonly CarouselLogo[]; columns?: number }) {
  const [still, setStill] = useState(false);
  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

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
        <Column key={i} logos={col} index={i} />
      ))}
    </div>
  );
}
