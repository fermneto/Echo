"use client";

import type { BoardTask, WorkBoard } from "@echo/agents";
import { scheduleDayLabel } from "@echo/domain";
import { useState, useTransition } from "react";
import type { AssignResult } from "./actions";

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Sugestão por regra: quem começaria mais cedo, entre quem não está ausente. A liderança só entra se não houver mais ninguém. */
function suggested(task: BoardTask, board: WorkBoard): string {
  const free = board.people.filter((p) => !p.away && task.starts[p.id]);
  const members = free.filter((p) => p.role === "member");
  const options = members.length ? members : free;
  options.sort((a, b) => task.starts[a.id]!.localeCompare(task.starts[b.id]!) || a.points - b.points);
  return options[0]?.id ?? "";
}

function TaskRow({ task, board, assign }: { task: BoardTask; board: WorkBoard; assign: (key: string, personId: string) => Promise<AssignResult> }) {
  const best = suggested(task, board);
  const [to, setTo] = useState(best);
  const [result, setResult] = useState<AssignResult | null>(null);
  const [pending, start] = useTransition();
  const meta = [task.dueDate ? `Prazo ${ddmm(task.dueDate)}` : "Sem prazo", `${task.size ?? 2} ${(task.size ?? 2) === 1 ? "ponto" : "pontos"}`, ...(task.blockedBy.length ? [`Depende de ${task.blockedBy.map((b) => (b.owner ? `${b.key} de ${b.owner}` : b.key)).join(", ")}`] : [])];
  return (
    <li className="board-task">
      <p className="board-task__title">
        <span className="mono agenda-key">{task.key}</span> {task.title}
      </p>
      <p className="board-task__meta">{meta.join(" · ")}</p>
      {result?.ok ? (
        <p className="board-task__done" role="status">
          {result.message}
        </p>
      ) : (
        <>
          <div className="board-task__form">
            <select className="field" value={to} aria-label={`Quem recebe ${task.key}`} disabled={pending} onChange={(e) => setTo(e.target.value)}>
              <option value="">Escolha a pessoa</option>
              {board.people.map((p) => {
                const day = task.starts[p.id];
                return (
                  <option key={p.id} value={p.id} disabled={p.away}>
                    {firstName(p.name)} · {p.away ? "ausente" : day ? `começaria ${scheduleDayLabel(day, board.today).toLowerCase()}, ${ddmm(day)}` : "sem dia nos próximos dias"}
                    {p.id === best ? " · sugerida" : ""}
                  </option>
                );
              })}
            </select>
            <button type="button" className="button-pill button-pill--sm" disabled={!to || pending} onClick={() => start(async () => setResult(await assign(task.key, to)))}>
              {pending ? "Atribuindo…" : "Atribuir"}
            </button>
          </div>
          {result && !result.ok && (
            <p className="board-task__done is-error" role="alert">
              {result.error}
            </p>
          )}
        </>
      )}
    </li>
  );
}

/** Mesa da liderança: à esquerda o que falta distribuir, à direita quanto cada pessoa já tem. */
export function Distribute({ board, assign }: { board: WorkBoard; assign: (key: string, personId: string) => Promise<AssignResult> }) {
  return (
    <div className="board">
      <section className="board-section" aria-labelledby="sem-responsavel">
        <h2 id="sem-responsavel">Sem responsável</h2>
        {board.tasks.length === 0 ? (
          <p className="agenda-empty">Todas as tarefas abertas já têm responsável.</p>
        ) : (
          <ul className="board-list">
            {board.tasks.map((t) => (
              <TaskRow key={t.key} task={t} board={board} assign={assign} />
            ))}
          </ul>
        )}
      </section>
      <section className="board-section" aria-labelledby="equipe-carga">
        <h2 id="equipe-carga">Equipe</h2>
        <ul className="board-list">
          {board.people.map((p) => (
            <li key={p.id} className="board-person">
              <div className="board-person__top">
                <span>{p.name}</span>
                <span className="mono">
                  {p.points} de {p.capacity} pontos
                </span>
              </div>
              {p.away && <p className="board-person__away">Ausente agora</p>}
              <p>{p.today.length ? `Hoje: ${p.today.map((t) => t.key).join(", ")}` : "Nada para hoje"}</p>
              <p>
                {p.nextFree ? `Próximo espaço: ${scheduleDayLabel(p.nextFree, board.today).toLowerCase()}, ${ddmm(p.nextFree)}` : "Agenda cheia nos próximos dias"}
                {p.waiting > 0 ? ` · ${p.waiting} esperando outra entrega` : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
