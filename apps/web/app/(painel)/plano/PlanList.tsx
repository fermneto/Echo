"use client";

import Link from "next/link";
import { useState } from "react";
import type { PlanItem } from "@/lib/demo/plan";

/** Resultado da decisão sobre uma correção real, já em palavras. `final`: não há mais o que decidir no item. */
export type FixDecisionView = { final: boolean; message: string };

/**
 * Plano da manhã: cada item tem uma ação principal (abrir onde se resolve, ou aprovar ali mesmo), na ordem da regra.
 * Nada sai daqui sem a pessoa decidir.
 */
export function PlanList({ initial, decideFix }: { initial: PlanItem[]; decideFix?: (fixId: string, decision: "approve" | "decline") => Promise<FixDecisionView> }) {
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

  if (initial.length === 0) {
    return (
      <div className="card plan-empty">
        <p>Nada no seu plano agora.</p>
      </div>
    );
  }

  return (
    <>
      <ol className="plan-list" aria-label="Itens do plano, em ordem">
        {initial.map((it, i) => {
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
            </li>
          );
        })}
      </ol>
    </>
  );
}
