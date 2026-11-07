"use client";

import { useState, useTransition } from "react";
import { budgetStatus, BUDGET, FLOWS, formatUsd, LEVEL_LABEL, MODEL_LABEL, RESULT_LABEL, type Run, runCost, totalCost, totalsByFlow } from "@/lib/demo/runs";
import { recriarDemo } from "./actions";

export type AuditEntry = { at: string; actor: string; action: string; target: string };

const seconds = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} s` : `${Math.round(ms / 60_000)} min`);
const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} mil` : String(n));

/** Totais por fluxo, limite mensal, lista de agent_runs e auditoria, com os controles de ensaio. */
export function RunsBoard({ day, night, audit, rehearsal }: { day: readonly Run[]; night: readonly Run[]; audit: AuditEntry[]; rehearsal: boolean }) {
  const [simulated, setSimulated] = useState(false);
  const [recreated, setRecreated] = useState(false);
  const [pending, start] = useTransition();
  const runs = simulated ? [...night, ...day] : [...day];
  const today = totalCost(runs);
  const budget = budgetStatus(today);
  const byRule = runs.filter((r) => !r.model).length;

  return (
    <>
      {rehearsal && (
      <section className="card rehearsal" aria-labelledby="ensaio">
        <h2 id="ensaio" className="card__title">
          Controles de ensaio
        </h2>
        <p className="muted rehearsal__hint">Só na demonstração. Simular a noite faz a mesma análise que o lote faria de madrugada.</p>
        <div className="report__actions">
          <button type="button" className="button-pill" disabled={simulated} onClick={() => setSimulated(true)}>
            {simulated ? "Noite simulada" : "Simular a noite"}
          </button>
          <button
            type="button"
            className="button-outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await recriarDemo();
                setSimulated(false);
                setRecreated(true);
              })
            }
          >
            {pending ? "Recriando…" : "Recriar a demonstração"}
          </button>
          {recreated && !pending && (
            <span className="chip mono" role="status">
              Demonstração recriada
            </span>
          )}
        </div>
      </section>
      )}

      <dl className="metrics runs-metrics">
        {[
          ["Custo no período", formatUsd(today)],
          ["Execuções", String(runs.length)],
          ["Por regra, sem modelo", String(byRule)],
          [`Gasto no mês, limite ${formatUsd(BUDGET.monthlyLimitUsd)}`, formatUsd(budget.spentUsd)],
        ].map(([k, v]) => (
          <div key={k} className="metric">
            <dd className="metric__v runs-metric__v">{v}</dd>
            <dt className="metric__k mono">{k}</dt>
          </div>
        ))}
      </dl>
      <div className="budget" aria-label={`Gasto do mês: ${Math.round(budget.ratio * 100)}% do limite`}>
        <div className="budget__bar">
          <span className="budget__fill" style={{ width: `${Math.min(100, budget.ratio * 100)}%` }} />
          <span className="budget__mark" style={{ left: "80%" }} aria-hidden="true" />
        </div>
        <p className="mono muted budget__label">
          {Math.round(budget.ratio * 100)}% do limite · {LEVEL_LABEL[budget.level]}
        </p>
      </div>

      <div className="profile-grid runs-grid">
        <section className="card" aria-labelledby="por-fluxo">
          <h2 id="por-fluxo" className="card__title">
            Custo por fluxo
          </h2>
          <table className="runs-table">
            <thead>
              <tr>
                <th scope="col">Fluxo</th>
                <th scope="col" className="num">
                  Execuções
                </th>
                <th scope="col" className="num">
                  Custo
                </th>
              </tr>
            </thead>
            <tbody>
              {totalsByFlow(runs).map((t) => (
                <tr key={t.flow}>
                  <th scope="row">
                    {t.label}
                    {t.byRule > 0 && <span className="mono muted runs-table__rule"> · {t.byRule} por regra</span>}
                  </th>
                  <td className="num mono">{t.runs}</td>
                  <td className="num mono">{formatUsd(t.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" aria-labelledby="auditoria">
          <h2 id="auditoria" className="card__title">
            Auditoria
          </h2>
          <ul className="audit" role="list">
            {audit.map((a) => (
              <li key={a.at + a.action + a.target}>
                <span className="mono muted">{a.at}</span>
                <span>
                  <strong>{a.actor}</strong> {a.action}: {a.target}
                </span>
              </li>
            ))}
          </ul>
          <p className="muted audit__foot">Somente adição. Ninguém apaga uma linha da auditoria.</p>
        </section>
      </div>

      <section className="card runs-list" aria-labelledby="execucoes">
        <h2 id="execucoes" className="card__title">
          Execuções
        </h2>
        <ol className="runs" role="list">
          {runs.map((r) => (
            <li key={r.id} className={`run${night.includes(r) ? " is-new" : ""}`}>
              <div className="run__head">
                <span className="chip mono">{FLOWS[r.flow]}</span>
                <span className={`chip mono run__result is-${r.result}`}>{RESULT_LABEL[r.result]}</span>
                <span className="mono muted run__at">{r.at}</span>
              </div>
              <p className="run__what">{r.what}</p>
              <p className="mono muted run__meta">
                {r.model ? `${MODEL_LABEL[r.model]}${r.batch ? " · lote" : ""} · ${tokens(r.inputTokens)} → ${tokens(r.outputTokens)} tokens` : "sem modelo"} · {seconds(r.durationMs)}
                {r.tools.length > 0 && ` · ${r.tools.join(", ")}`} · <span className="run__cost">{formatUsd(runCost(r))}</span>
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
