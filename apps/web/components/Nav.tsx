"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NavGroup } from "@/lib/access";
import { EASE_IN, gsap, leave, prefersReduced, useGSAP } from "@/lib/motion";

/** Pausa antes de fechar ao tirar o mouse: dá tempo de atravessar o vão entre a aba e o menu. */
const CLOSE_DELAY_MS = 180;

/**
 * Abas do painel: Início e grupos que abrem um menu com uma linha sobre cada tela.
 * Um destaque desliza atrás da aba sob o ponteiro; o menu abre a partir da aba, com os itens
 * entrando em sequência, e fecha mais rápido do que abre. Com mouse, o menu abre ao passar por cima;
 * no toque e no teclado, pelo clique.
 */
export function Nav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  /** Menu montado: continua na tela durante a animação de saída. */
  const [shown, setShown] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const { contextSafe } = useGSAP({ scope: ref });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** O menu aberto veio do hover: o clique na aba não deve fechá-lo logo em seguida. */
  const byHover = useRef(false);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => cancelClose, []);

  useEffect(() => setOpen(null), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Abrir monta na hora; fechar espera a saída terminar.
  useEffect(() => {
    if (open) {
      setShown(open);
      return;
    }
    if (!shown || !menu.current) {
      setShown(null);
      return;
    }
    leave(menu.current, { duration: 0.14, onComplete: () => setShown(null) });
    // shown fica de fora: só a mudança de open dispara a saída.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Entrada do menu recém-montado: a caixa a partir da aba e os itens em sequência.
  useLayoutEffect(() => {
    const el = menu.current;
    if (!el || !shown || !open) return;
    if (prefersReduced()) return;
    const items = el.querySelectorAll(".tabs__item");
    const tl = gsap.timeline();
    tl.fromTo(el, { opacity: 0, y: -6, scale: 0.97, filter: "blur(6px)" }, { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: 0.3, ease: EASE_IN, clearProps: "filter,transform" });
    tl.fromTo(items, { opacity: 0, y: 6, filter: "blur(4px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.32, ease: EASE_IN, stagger: 0.035, clearProps: "filter,transform" }, 0.04);
    return () => {
      tl.kill();
    };
  }, [shown, open]);

  const moveGlow = contextSafe((target: HTMLElement) => {
    const g = glow.current;
    const nav = ref.current;
    if (!g || !nav) return;
    const a = target.getBoundingClientRect();
    const b = nav.getBoundingClientRect();
    const x = a.left - b.left + nav.scrollLeft - 10;
    const width = a.width + 20;
    if (prefersReduced()) return gsap.set(g, { x, width, opacity: 1 });
    const visible = Number(gsap.getProperty(g, "opacity")) > 0.05;
    gsap.to(g, { x, width, opacity: 1, duration: visible ? 0.32 : 0, ease: EASE_IN, overwrite: true });
  });
  const hideGlow = contextSafe(() => {
    if (glow.current) gsap.to(glow.current, { opacity: 0, duration: 0.2, ease: "power1.out", overwrite: "auto" });
  });

  const isActive = (href: string) => pathname.startsWith(href);
  const hover = { onPointerEnter: (e: React.PointerEvent<HTMLElement>) => e.pointerType === "mouse" && moveGlow(e.currentTarget) };
  const groupHover = (label: string) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      cancelClose();
      if (open !== label) byHover.current = true;
      setOpen(label);
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") return;
      cancelClose();
      closeTimer.current = setTimeout(() => setOpen((cur) => (cur === label ? null : cur)), CLOSE_DELAY_MS);
    },
  });
  const toggle = (label: string, expanded: boolean) => {
    cancelClose();
    if (expanded && byHover.current) {
      byHover.current = false;
      return;
    }
    byHover.current = false;
    setOpen(expanded ? null : label);
  };

  return (
    <nav className="tabs" ref={ref} aria-label="Painel" onPointerLeave={hideGlow}>
      <span className="tabs__glow" ref={glow} aria-hidden="true" />
      <Link href="/dashboard" className={`tabs__tab label-caps${isActive("/dashboard") ? " is-active" : ""}`} aria-current={isActive("/dashboard") ? "page" : undefined} {...hover}>
        Início
      </Link>
      {groups.map((g) => {
        const active = g.items.some((i) => isActive(i.href));
        const expanded = open === g.label;
        return (
          <div key={g.label} className="tabs__group" {...groupHover(g.label)}>
            <button type="button" className={`tabs__tab label-caps${active ? " is-active" : ""}`} aria-expanded={expanded} onClick={() => toggle(g.label, expanded)} {...hover}>
              {g.label}
              <svg className="tabs__chevron" viewBox="0 0 10 10" aria-hidden="true">
                <path d="m2.5 4 2.5 2.5L7.5 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {shown === g.label && (
              <ul className="tabs__menu" role="list" ref={menu}>
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} className="tabs__item" aria-current={isActive(i.href) ? "page" : undefined}>
                      <span className="tabs__item-label">
                        {isActive(i.href) && <span className="dot dot--on" aria-hidden="true" />}
                        {i.label}
                      </span>
                      {i.hint && <span className="tabs__item-hint">{i.hint}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
