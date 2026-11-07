"use client";

import { useRef } from "react";
import { EASE_IN, gsap, prefersReduced, useGSAP } from "@/lib/motion";

/**
 * Texto que surge palavra por palavra, saindo do desfoque. Usado na resposta recém-chegada de um
 * agente; o texto inteiro continua no DOM desde o início (leitores de tela leem tudo de uma vez).
 */
export function RevealText({ text, animate = true }: { text: string; animate?: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      if (!animate || prefersReduced() || !root.current) return;
      const words = root.current.querySelectorAll(".reveal-word");
      gsap.fromTo(
        words,
        { opacity: 0, filter: "blur(6px)", y: 3 },
        { opacity: 1, filter: "blur(0px)", y: 0, duration: 0.5, ease: EASE_IN, stagger: Math.min(0.03, 0.9 / Math.max(words.length, 1)), clearProps: "filter,transform" },
      );
    },
    { scope: root, dependencies: [text] },
  );
  const parts = text.split(/(\s+)/);
  return (
    <span ref={root}>
      {parts.map((p, i) =>
        /^\s+$/.test(p) ? (
          p
        ) : (
          <span key={i} className="reveal-word">
            {p}
          </span>
        ),
      )}
    </span>
  );
}
