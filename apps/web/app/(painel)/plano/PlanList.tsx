"use client";

import Link from "next/link";
import { useState } from "react";
import { move, type PlanItem } from "@/lib/demo/plan";

function Arrow({ up }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={up ? "M12 19V5M6 11l6-6 6 6" : "M12 5v14M6 13l6 6 6-6"} />
    </svg>
  );
}

/**
 * Plano da manhã: cada item tem uma ação principal (abrir onde se resolve, ou aprovar ali mesmo).
 * Reordenar e descartar são secundários. Nada sai daqui sem a pessoa decidir.
 */
export function PlanList({ initial }: { initial: PlanItem[] }) {
  const [items, setItems] = useState(initial);
  const [dropped, setDropped] = useState<PlanItem[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());

  if (items.length === 0) {
    return (
      <div className="card plan-empty">
        <p>Nada no seu plano agora.</p>
        {dropped.length > 0 && (
          <button type="button" className="button-outline" onClick={() => (setItems(dropped), setDropped([]))}>
            Desfazer descartes
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <ol className="plan-list" aria-label="Itens do plano, em ordem">
        {items.map((it, i) => {
          const isDone = done.has(it.id);
          return (
            <li key={it.id} className={`card plan-item${isDone ? " is-done" : ""}`}>
              <span className="plan-item__n mono" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="plan-item__body">
                <p className="plan-item__title">{it.title}</p>
                <p className="plan-item__why">{isDone && it.action?.done ? it.action.done : it.why}</p>
                <div className="plan-item__foot">
                  <span className={`chip mono plan-item__kind is-${it.kind === "esperando" ? "wait" : "off"}`}>
                    <span className={`dot dot--${it.kind === "esperando" ? "wait" : "off"}`} aria-hidden="true" />
                    {it.kind}
                  </span>
                  {it.action && !isDone &&
                    (it.action.href ? (
                      <Link href={it.action.href} className="button-pill button-pill--sm">
                        {it.action.label}
                      </Link>
                    ) : (
                      <button type="button" className="button-pill button-pill--sm" onClick={() => setDone((s) => new Set(s).add(it.id))}>
                        {it.action.label}
                      </button>
                    ))}
                  {isDone && (
                    <button
                      type="button"
                      className="link-inline plan-item__undo"
                      onClick={() =>
                        setDone((s) => {
                          const n = new Set(s);
                          n.delete(it.id);
                          return n;
                        })
                      }
                    >
                      Desfazer
                    </button>
                  )}
                </div>
              </div>
              <div className="plan-item__actions">
                <button type="button" className="icon-button" disabled={i === 0} onClick={() => setItems((l) => move(l, i, -1))} aria-label={`Subir: ${it.title}`} title="Subir">
                  <Arrow up />
                </button>
                <button type="button" className="icon-button" disabled={i === items.length - 1} onClick={() => setItems((l) => move(l, i, 1))} aria-label={`Descer: ${it.title}`} title="Descer">
                  <Arrow />
                </button>
                <button
                  type="button"
                  className="link-inline plan-item__drop"
                  onClick={() => {
                    setDropped((d) => [...d, it]);
                    setItems((l) => l.filter((x) => x.id !== it.id));
                  }}
                  aria-label={`Descartar: ${it.title}`}
                >
                  Descartar
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      {dropped.length > 0 && (
        <p className="plan-dropped muted">
          {dropped.length} {dropped.length === 1 ? "item descartado" : "itens descartados"}.{" "}
          <button type="button" className="link-inline" onClick={() => (setItems((l) => [...l, ...dropped]), setDropped([]))}>
            Desfazer
          </button>
        </p>
      )}
    </>
  );
}
