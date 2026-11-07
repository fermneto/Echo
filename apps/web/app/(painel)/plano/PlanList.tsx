"use client";

import { useState } from "react";
import { move, type PlanItem } from "@/lib/demo/plan";

/** Plano da manhã: a pessoa reordena e descarta. Nada sai daqui sem ela decidir. */
export function PlanList({ initial }: { initial: PlanItem[] }) {
  const [items, setItems] = useState(initial);
  const [dropped, setDropped] = useState<PlanItem[]>([]);

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
        {items.map((it, i) => (
          <li key={it.id} className="card plan-item">
            <span className="plan-item__n mono" aria-hidden="true">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="plan-item__body">
              <p className="plan-item__title">{it.title}</p>
              <p className="plan-item__why">{it.why}</p>
              <span className={`chip mono plan-item__kind is-${it.kind === "esperando" ? "wait" : "off"}`}>
                <span className={`dot dot--${it.kind === "esperando" ? "wait" : "off"}`} aria-hidden="true" />
                {it.kind}
              </span>
            </div>
            <div className="plan-item__actions">
              <button type="button" className="button-outline" disabled={i === 0} onClick={() => setItems((l) => move(l, i, -1))} aria-label={`Subir: ${it.title}`}>
                Subir
              </button>
              <button type="button" className="button-outline" disabled={i === items.length - 1} onClick={() => setItems((l) => move(l, i, 1))} aria-label={`Descer: ${it.title}`}>
                Descer
              </button>
              <button
                type="button"
                className="button-outline"
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
        ))}
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
