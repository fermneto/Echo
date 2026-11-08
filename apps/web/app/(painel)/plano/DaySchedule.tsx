"use client";

import { type PersonSchedule, type ScheduleEntry, SCHEDULE_RULES, scheduleDayLabel, type SchedulePart } from "@echo/domain";
import { useState, useTransition } from "react";

export type MoveResult = { ok: true } | { ok: false; error: string };

const PART: Record<SchedulePart, string> = { inteira: "Fazer", inicia: "Começar", continua: "Continuar", conclui: "Terminar" };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Mudar o dia: a lista é a dos próximos dias de trabalho; a tarefa escolhida à mão pode voltar à sugestão. */
function MoveDay({ entry, today, dates, disabled, onMove }: { entry: ScheduleEntry; today: string; dates: string[]; disabled: boolean; onMove: (key: string, date: string | null) => void }) {
  return (
    <select
      className="field agenda-move"
      aria-label={`Mudar o dia de ${entry.key}`}
      value=""
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value) onMove(entry.key, e.target.value === "sugestao" ? null : e.target.value);
      }}
    >
      <option value="">Mudar o dia</option>
      {dates.map((d) => (
        <option key={d} value={d}>
          {scheduleDayLabel(d, today)}, {ddmm(d)}
        </option>
      ))}
      {entry.pinned && <option value="sugestao">Voltar à sugestão</option>}
    </select>
  );
}

/**
 * O plano como agenda: hoje em ordem, com o motivo de cada tarefa, e os próximos dias ao lado.
 * A sugestão vem de regras. Só a pessoa muda o dia, e isso fica no Echo.
 */
export function DaySchedule({ today, schedule, move }: { today: string; schedule: PersonSchedule; move: (key: string, date: string | null) => Promise<MoveResult> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const onMove = (key: string, date: string | null) =>
    start(async () => {
      const r = await move(key, date);
      setError(r.ok ? null : r.error);
    });

  const dates = schedule.days.map((d) => d.date);
  // Fim de semana ou folga: o destaque vai para o próximo dia de trabalho.
  const now = schedule.days[0];
  const next = schedule.days.slice(1);

  return (
    <section className="agenda" aria-label="Agenda dos próximos dias" aria-busy={pending}>
      <div className="agenda-today">
        <header className="agenda-head">
          <h2 className="agenda-head__title">{now ? `${scheduleDayLabel(now.date, today)}${now.date === today ? "" : `, ${ddmm(now.date)}`}` : "Sem dias de trabalho"}</h2>
          {now && (
            <span className="mono agenda-head__load">
              {now.points} de {SCHEDULE_RULES.pointsPerDay} pontos
            </span>
          )}
        </header>
        {now && now.entries.length > 0 ? (
          <ol className="agenda-list">
            {now.entries.map((e, i) => (
              <li key={e.key} className="agenda-task">
                <span className="agenda-task__n mono" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="agenda-task__body">
                  <p className="agenda-task__title">
                    <span className="mono agenda-key">{e.key}</span> {e.title}
                  </p>
                  <p className={`agenda-task__why${e.late ? " is-late" : ""}`}>
                    {PART[e.part]}. {sentence(e.reason)}.
                  </p>
                </div>
                <MoveDay entry={e} today={today} dates={dates} disabled={pending} onMove={onMove} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="agenda-empty">{now ? "Nenhuma tarefa neste dia. O que chegar da liderança entra aqui." : "Não há dias de trabalho na sua agenda nas próximas semanas."}</p>
        )}
      </div>

      {error && (
        <p className="agenda-error" role="alert">
          {error}
        </p>
      )}

      {next.length > 0 && (
        <div className="agenda-week" aria-label="Próximos dias">
          {next.map((d) => (
            <div key={d.date} className="agenda-day">
              <header className="agenda-day__head">
                <h3>{scheduleDayLabel(d.date, today)}</h3>
                <span className="mono">{ddmm(d.date)}</span>
              </header>
              {d.entries.length === 0 ? (
                <p className="agenda-day__free">Livre</p>
              ) : (
                <ul>
                  {d.entries.map((e) => (
                    <li key={e.key}>
                      <span className="mono agenda-key">{e.key}</span>
                      <span className="agenda-day__title">{e.title}</span>
                      <span className={`agenda-day__part${e.late ? " is-late" : ""}`}>
                        {PART[e.part]}. {sentence(e.reason)}.
                      </span>
                      <MoveDay entry={e} today={today} dates={dates} disabled={pending} onMove={onMove} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {schedule.waiting.length > 0 && (
        <div className="agenda-side">
          <h3>
            <span className="dot dot--wait" aria-hidden="true" /> Esperando outra entrega
          </h3>
          <ul>
            {schedule.waiting.map((w) => (
              <li key={w.key}>
                <span className="mono agenda-key">{w.key}</span> {w.title}
                <span className="agenda-side__why">
                  Espera {w.waitingOn.map((b) => (b.owner ? `${b.key} de ${b.owner}` : b.key)).join(", ") || "uma entrega sem previsão"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {schedule.later.length > 0 && <p className="agenda-later">Mais {schedule.later.length === 1 ? "1 tarefa" : `${schedule.later.length} tarefas`} depois destes dias: {schedule.later.map((l) => l.key).join(", ")}.</p>}
    </section>
  );
}
