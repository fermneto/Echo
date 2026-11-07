"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Reveal } from "./Reveal";

export type WaitingView = { key: string; id: string; text: string; since: string; detail: string; action: { label: string; href: string } };

/** "Tasks aguardando você": cada item abre embaixo o porquê e onde se resolve. */
export function WaitingStrip({ items }: { items: WaitingView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = items.find((w) => w.key === open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <section className="waiting-strip" aria-label="Tasks aguardando você">
      <div className="waiting-strip__row">
        <span className="waiting-strip__label mono">
          <span className="dot dot--wait" aria-hidden="true" />
          Tasks aguardando você
        </span>
        {items.length > 0 ? (
          <ul className="waiting-strip__list" role="list">
            {items.map((w) => (
              <li key={w.key}>
                <button
                  type="button"
                  className={`waiting-chip${open === w.key ? " is-open" : ""}`}
                  aria-expanded={open === w.key}
                  aria-controls="waiting-detail"
                  onClick={() => setOpen((o) => (o === w.key ? null : w.key))}
                >
                  <span className="waiting-chip__title">{w.text}</span>
                  <span className="waiting-chip__meta mono">
                    {w.id} · {w.since}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted waiting-strip__empty">Nada esperando você agora.</p>
        )}
      </div>
      {current && (
        <Reveal key={current.key} id="waiting-detail" className="waiting-detail" role="region" aria-label={current.text}>
          <div className="waiting-detail__body">
            <p className="waiting-detail__title">{current.text}</p>
            <p className="waiting-detail__text">{current.detail}</p>
            <p className="mono muted waiting-detail__meta">
              {current.id} · esperando desde {current.since}
            </p>
          </div>
          <div className="waiting-detail__actions">
            <Link href={current.action.href} className="button-pill button-pill--sm">
              {current.action.label}
            </Link>
            <button type="button" className="link-inline waiting-detail__close" onClick={() => setOpen(null)}>
              Fechar
            </button>
          </div>
        </Reveal>
      )}
    </section>
  );
}
