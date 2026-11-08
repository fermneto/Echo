"use client";

import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { enter, useGSAP } from "@/lib/motion";

/**
 * Na carga inicial não anima: a tela com skeleton chega em partes, e mexer nela antes da hidratação quebra o React.
 * Ao trocar de tela, as seções entram em sequência, de leve. Só as primeiras, para não atrasar a leitura.
 */
export function PageEnter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef(pathname);
  useGSAP(
    () => {
      const el = root.current;
      if (!el || shown.current === pathname) return;
      shown.current = pathname;
      const blocks = Array.from(el.children).slice(0, 6);
      enter(blocks, { duration: 0.5, stagger: 0.05 });
    },
    { scope: root, dependencies: [pathname] },
  );
  return (
    <div ref={root} className="page-enter">
      {children}
    </div>
  );
}
