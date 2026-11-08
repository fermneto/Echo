"use client";

import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/**
 * Linguagem de movimento do painel: entradas curtas com desaceleração exponencial, desfoque que
 * some ao chegar e saídas mais rápidas que as entradas. Com "reduzir movimento", nada se mexe:
 * cada helper vira um set instantâneo.
 */

export const EASE_IN = "expo.out";
export const EASE_OUT = "power2.in";

export function prefersReduced(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Surge de leve: opacidade, desfoque e um pequeno deslocamento. */
export function enter(targets: gsap.TweenTarget, vars: gsap.TweenVars = {}) {
  if (prefersReduced()) return gsap.set(targets, { opacity: 1, clearProps: "filter,transform" });
  return gsap.fromTo(
    targets,
    { opacity: 0, y: 6, filter: "blur(6px)" },
    { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.45, ease: EASE_IN, clearProps: "filter,transform", ...vars },
  );
}

/** Some na direção contrária, mais rápido que a entrada. */
export function leave(targets: gsap.TweenTarget, vars: gsap.TweenVars = {}) {
  if (prefersReduced()) {
    gsap.set(targets, { opacity: 0 });
    (vars.onComplete as (() => void) | undefined)?.();
    return;
  }
  return gsap.to(targets, { opacity: 0, y: -4, filter: "blur(4px)", duration: 0.16, ease: EASE_OUT, ...vars });
}

/** Expande a altura a partir de zero, como um painel que se abre. */
export function expand(el: HTMLElement) {
  if (prefersReduced()) return gsap.set(el, { clearProps: "height,opacity" });
  return gsap.fromTo(el, { height: 0, opacity: 0, overflow: "hidden" }, { height: "auto", opacity: 1, duration: 0.42, ease: EASE_IN, clearProps: "height,overflow" });
}

export { gsap, useGSAP };
