"use client";

import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { expand, useGSAP } from "@/lib/motion";

/** Bloco que abre a altura ao aparecer, como um painel se desdobrando (confirmações, resumos). */
export function Reveal({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (ref.current) expand(ref.current);
  });
  return (
    <div ref={ref} {...rest}>
      {children}
    </div>
  );
}
