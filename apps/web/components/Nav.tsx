"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavGroup } from "@/lib/access";

/** Abas do painel: Início e grupos que abrem um menu com uma linha sobre cada tela. */
export function Nav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

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

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="tabs" ref={ref} aria-label="Painel">
      <Link href="/" className={`tabs__tab label-caps${isActive("/") ? " is-active" : ""}`} aria-current={isActive("/") ? "page" : undefined}>
        Início
      </Link>
      {groups.map((g) => {
        const active = g.items.some((i) => isActive(i.href));
        const expanded = open === g.label;
        return (
          <div key={g.label} className="tabs__group">
            <button type="button" className={`tabs__tab label-caps${active ? " is-active" : ""}`} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : g.label)}>
              {g.label}
              <svg className="tabs__chevron" viewBox="0 0 10 10" aria-hidden="true">
                <path d="m2.5 4 2.5 2.5L7.5 4" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {expanded && (
              <ul className="tabs__menu" role="list">
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
