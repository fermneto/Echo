"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavGroup } from "@/lib/access";

/** Navegação do painel: grupos em rótulo maiúsculo que abrem um menu flutuante de 320px. */
export function Nav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

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
    <div className="nav" ref={ref}>
      {groups.map((g) => {
        const active = g.items.some((i) => isActive(i.href));
        const expanded = open === g.label;
        return (
          <div key={g.label} className="nav__group">
            <button
              type="button"
              className={`label-caps nav__trigger${active ? " is-active" : ""}`}
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : g.label)}
            >
              {g.label}
            </button>
            {expanded && (
              <ul className="nav__menu" role="list">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} className="nav__item" aria-current={isActive(i.href) ? "page" : undefined}>
                      {isActive(i.href) && <span className="dot dot--on" aria-hidden="true" />}
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
