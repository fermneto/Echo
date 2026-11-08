"use client";

import type { ButtonHTMLAttributes } from "react";
import type { Look } from "@/lib/demo/looks";
import type { MiniData } from "@/lib/mini";
import { PixelSprite } from "./PixelSprite";
import "./mini-echo.css";

export type MiniTab = "tarefas" | "mensagens";

type Props = {
  look: Look;
  data: MiniData | null;
  failed: boolean;
  fresh: number;
  /** null: recolhido, só o bonequinho. */
  tab: MiniTab | null;
  spriteSize?: number;
  /** Extras do botão do bonequinho: no app de computador, é por ele que se arrasta. */
  iconProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  onExpand: () => void;
  onCollapse: () => void;
  onPick: (tab: MiniTab) => void;
};

/** O Mini Echo em si, igual na janela do navegador e no app de computador. O agente sempre se identifica. */
export function MiniView({ look, data, failed, fresh, tab, spriteSize = 52, iconProps, onExpand, onCollapse, onPick }: Props) {
  const tasks = data?.tasks.length ?? 0;

  if (tab === null) {
    return (
      <button type="button" className="mini-icon" aria-label={`${data?.agent ?? "Agente"}: ${fresh > 0 ? `${fresh} ${fresh === 1 ? "mensagem nova" : "mensagens novas"}` : "sem mensagens novas"}. Expandir.`} {...iconProps} onClick={onExpand}>
        <span className="mini-icon__sprite">
          <PixelSprite look={look} mode="twin" size={spriteSize} />
          {fresh > 0 && (
            <span className="mini-icon__badge" aria-hidden="true">
              {fresh}
            </span>
          )}
        </span>
      </button>
    );
  }

  return (
    <div className="mini">
      <header className="mini__bar">
        <button type="button" className="mini__head" aria-label="Recolher para o bonequinho" onClick={onCollapse}>
          <PixelSprite look={look} mode="twin" size={28} />
          <span className="mini__who">{data?.agent ?? "Carregando…"}</span>
          <span className="mini__collapse mono">RECOLHER</span>
        </button>
        <div className="mini__counts">
          <button type="button" className="mini__count" aria-pressed={tab === "tarefas"} onClick={() => onPick("tarefas")}>
            <b>{tasks}</b> {tasks === 1 ? "tarefa" : "tarefas"}
          </button>
          <button type="button" className={`mini__count${fresh > 0 ? " is-new" : ""}`} aria-pressed={tab === "mensagens"} onClick={() => onPick("mensagens")}>
            {fresh > 0 ? (
              <>
                <b>{fresh}</b> {fresh === 1 ? "nova" : "novas"}
              </>
            ) : (
              "Sem novas"
            )}
          </button>
        </div>
      </header>
      {failed && <p className="mini__empty">Não consegui atualizar agora. Tento de novo em 1 minuto.</p>}
      {tab === "tarefas" && (
        <ul className="mini__list">
          {data?.tasks.map((t) => (
            <li key={t.key} className="mini__item">
              {t.ref && <span className="mini__ref mono">{t.ref}</span>}
              <span>{t.title}</span>
              {t.late && <span className="mini__late">Pode atrasar</span>}
            </li>
          ))}
          {tasks === 0 && <li className="mini__empty">Nenhuma tarefa para agora.</li>}
        </ul>
      )}
      {tab === "mensagens" && (
        <ul className="mini__list">
          {data?.messages.map((m) => (
            <li key={m.key} className="mini__item">
              <span className="mini__ref mono">
                {m.time}
                {m.waiting && <span className="mini__wait"> · espera você</span>}
              </span>
              <span>{m.text}</span>
            </li>
          ))}
          {data?.messages.length === 0 && <li className="mini__empty">Nada novo desde o fim do seu expediente.</li>}
        </ul>
      )}
    </div>
  );
}
