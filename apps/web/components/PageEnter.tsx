"use client";

import { usePathname } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { enter, useGSAP } from "@/lib/motion";

/** Ao trocar de tela, as seções entram em sequência, de leve. Só as primeiras, para não atrasar a leitura. */
export function PageEnter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
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
