"use client";

import Link from "next/link";
import { useState } from "react";
import { move, type PlanItem } from "@/lib/demo/plan";
import { collapse } from "@/lib/motion";

/** Resultado da decisão sobre uma correção real, já em palavras. `final`: não há mais o que decidir no item. */
export type FixDecisionView = { final: boolean; message: string };

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
export function PlanList({ initial, decideFix }: { initial: PlanItem[]; decideFix?: (fixId: string, decision: "approve" | "decline") => Promise<FixDecisionView> }) {
  const [items, setItems] = useState(initial);
  const [dropped, setDropped] = useState<PlanItem[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  // Correção real: o resultado vem do servidor (aprovada, recusada ou por que não deu).
  const [fixResult, setFixResult] = useState<Record<string, FixDecisionView>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const decide = async (it: PlanItem, decision: "approve" | "decline") => {
    if (!decideFix || !it.fixId) return;
    setBusy(it.id);
    try {
      const r = await decideFix(it.fixId, decision);
      setFixResult((m) => ({ ...m, [it.id]: r }));
    } finally {
      setBusy(null);
    }
  };

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
          const fixed = fixResult[it.id];
          const isDone = done.has(it.id) || Boolean(fixed?.final);
          return (
            <li key={it.id} className={`card plan-item${isDone ? " is-done" : ""}`}>
              <span className="plan-item__n mono" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="plan-item__body">
                <p className="plan-item__title">{it.title}</p>
                <p className="plan-item__why">{fixed ? fixed.message : isDone && it.action?.done ? it.action.done : it.why}</p>
                <div className="plan-item__foot">
                  <span className={`chip mono plan-item__kind is-${it.kind === "esperando" ? "wait" : "off"}`}>
                    <span className={`dot dot--${it.kind === "esperando" ? "wait" : "off"}`} aria-hidden="true" />
                    {it.kind}
                  </span>
                  {it.fixId && decideFix && !fixed?.final && (
                    <>
                      <button type="button" className="button-pill button-pill--sm" disabled={busy === it.id} onClick={() => void decide(it, "approve")}>
                        {busy === it.id ? "Conferindo…" : "Aprovar a correção"}
                      </button>
                      <button type="button" className="link-inline" disabled={busy === it.id} onClick={() => void decide(it, "decline")}>
                        Recusar
                      </button>
                    </>
                  )}
                  {!it.fixId && it.action && !isDone &&
                    (it.action.href ? (
                      <Link href={it.action.href} className="button-pill button-pill--sm">
                        {it.action.label}
                      </Link>
                    ) : (
                      <button type="button" className="button-pill button-pill--sm" onClick={() => setDone((s) => new Set(s).add(it.id))}>
                        {it.action.label}
                      </button>
                    ))}
                  {isDone && !it.fixId && (
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
                  onClick={(e) => {
                    // O item fecha a altura antes de sair, e a lista se ajusta sem salto.
                    const li = e.currentTarget.closest("li");
                    const drop = () => {
                      setDropped((d) => [...d, it]);
                      setItems((l) => l.filter((x) => x.id !== it.id));
                    };
                    if (li) collapse(li, drop);
                    else drop();
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
