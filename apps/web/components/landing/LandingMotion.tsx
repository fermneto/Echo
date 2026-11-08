"use client";

import { ScrollTrigger } from "gsap/ScrollTrigger";
import { EASE_IN, gsap, useGSAP } from "@/lib/motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * Movimento das partes estáticas da landing, disparado pela rolagem. Cada efeito diz algo: no ciclo, o dono de cada
 * decisão acende em ordem; no relatório, os números se somam e a fala da pessoa chega por último, sem mudá-los.
 * Sem JS ou com "reduzir movimento", tudo fica no estado final.
 */
export function LandingMotion() {
  useGSAP(() => {
    gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
      gsap.set(".lp-day__item", { opacity: 0.25 });
      gsap.set(".lp-day__who .lp-dot", { scale: 0 });
      ScrollTrigger.batch(".lp-day__item", {
        start: "top 82%",
        once: true,
        onEnter: (items) => {
          gsap.to(items, { opacity: 1, duration: 0.6, ease: EASE_IN, stagger: 0.12 });
          gsap.to(items.map((i) => i.querySelector(".lp-day__who .lp-dot")), { scale: 1, duration: 0.5, ease: "back.out(3)", stagger: 0.12, delay: 0.25 });
        },
      });

      gsap.set(".lp-gains tbody tr", { opacity: 0, y: 10 });
      gsap.set(".lp-gains__after", { opacity: 0, x: -10 });
      ScrollTrigger.batch(".lp-gains tbody tr", {
        start: "top 86%",
        once: true,
        onEnter: (rows) => {
          gsap.to(rows, { opacity: 1, y: 0, duration: 0.5, ease: EASE_IN, stagger: 0.1 });
          gsap.to(rows.map((r) => r.querySelector(".lp-gains__after")), { opacity: 1, x: 0, duration: 0.6, ease: EASE_IN, stagger: 0.1, delay: 0.25 });
        },
      });

      const report = document.querySelector(".lp-win--static");
      const count = report?.querySelector<HTMLElement>("[data-count]");
      if (report && count) {
        const target = Number(count.dataset.count);
        const tally = { n: 0 };
        count.textContent = "0";
        gsap.set(".lp-win--static .lp-row:not(.lp-row--note)", { opacity: 0, x: -8 });
        gsap.set(".lp-win--static .lp-row--note", { opacity: 0, y: 8 });
        gsap
          .timeline({ scrollTrigger: { trigger: report, start: "top 72%", once: true } })
          .to(".lp-win--static .lp-row:not(.lp-row--note)", { opacity: 1, x: 0, duration: 0.45, ease: EASE_IN, stagger: 0.14 })
          .to(tally, { n: target, duration: 0.9, ease: "power2.out", onUpdate: () => void (count.textContent = String(Math.round(tally.n))) }, 0.3)
          .to(".lp-win--static .lp-row--note", { opacity: 1, y: 0, duration: 0.5, ease: EASE_IN }, 1.2);
      }

      gsap.set(".lp-never li", { opacity: 0, x: -10 });
      ScrollTrigger.batch(".lp-never li", {
        start: "top 88%",
        once: true,
        onEnter: (items) => gsap.to(items, { opacity: 1, x: 0, duration: 0.5, ease: EASE_IN, stagger: 0.07 }),
      });
    });
  });
  return null;
}
