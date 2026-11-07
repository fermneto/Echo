"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Sem acento e em minúsculas: "Inês" acha "ines", "Pagamentos" acha "pagamento". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** Todas as palavras da busca precisam aparecer no texto do item, em qualquer ordem. */
export function matches(text: string, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = normalize(text);
  return words.every((w) => hay.includes(w));
}

/**
 * Busca que filtra a lista abaixo enquanto se digita. Cada item marca o próprio texto em
 * data-search; um grupo marcado com data-search-group some quando nenhum item dele aparece.
 */
export function SearchFilter({ label, placeholder, empty, children }: { label: string; placeholder: string; empty: string; children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = box.current;
    if (!root) return;
    let count = 0;
    root.querySelectorAll<HTMLElement>("[data-search]").forEach((el) => {
      const ok = matches(el.dataset.search ?? "", query);
      el.hidden = !ok;
      if (ok) count += 1;
    });
    root.querySelectorAll<HTMLElement>("[data-search-group]").forEach((g) => {
      g.hidden = !g.querySelector("[data-search]:not([hidden])");
    });
    setShown(query.trim() ? count : null);
  }, [query]);

  return (
    <>
      <div className="search-filter">
        <svg className="search-filter__icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
        <label className="sr-only" htmlFor="busca">
          {label}
        </label>
        <input
          id="busca"
          type="search"
          className="search-filter__input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          autoComplete="off"
        />
        {shown !== null && (
          <span className="mono muted search-filter__count" role="status">
            {shown} {shown === 1 ? "resultado" : "resultados"}
          </span>
        )}
      </div>
      <div ref={box}>
        {children}
        {shown === 0 && <p className="muted search-filter__empty">{empty}</p>}
      </div>
    </>
  );
}
