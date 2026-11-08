"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Se a troca de tela não terminar neste tempo, a linha some em vez de ficar para sempre. */
const GIVE_UP_MS = 15_000;

/** Linha fina no topo enquanto a próxima tela não chega: responde ao clique em todas as rotas do painel. */
export function NavProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  useEffect(() => setActive(false), [pathname]);

  useEffect(() => {
    // Em captura: o Link do Next cancela o evento antes de ele subir até o documento.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href);
      if (url.origin === location.origin && url.pathname !== location.pathname && !url.pathname.startsWith("/api/")) setActive(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [active]);

  return active ? <div className="nav-progress" aria-hidden="true" /> : null;
}
