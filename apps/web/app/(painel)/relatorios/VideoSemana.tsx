"use client";

import { useRef } from "react";
import type { TeamVideo } from "@/lib/team-videos";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function TeamVideoItem({ v }: { v: TeamVideo }) {
  const player = useRef<HTMLVideoElement>(null);
  const seek = (at: number) => {
    if (!player.current) return;
    player.current.currentTime = at;
    void player.current.play().catch(() => undefined);
  };
  return (
    <article className="team-video">
      <header className="team-video__head">
        <p className="team-video__title">
          Equipe {v.teamName} · semana de {v.weekLabel}
        </p>
        {v.durationS ? <span className="mono muted">{clock(v.durationS)}</span> : null}
      </header>
      {v.url ? (
        <div className="team-video__body">
          <video ref={player} className="team-video__player" src={v.url} controls preload="metadata" playsInline aria-label={`Vídeo da semana da equipe ${v.teamName}`} />
          {v.chapters.length > 0 && (
            <ol className="team-video__chapters" role="list" aria-label="Cenas">
              {v.chapters.map((c, i) => (
                <li key={i}>
                  <button type="button" className="team-video__chapter" onClick={() => seek(c.at)}>
                    <span className="mono">{clock(c.at)}</span>
                    <span>{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <p className="muted team-video__note">{v.state === "ready" ? "O vídeo está pronto, mas não pôde ser carregado agora." : "O Echo está montando o vídeo desta semana. Ele aparece aqui quando ficar pronto."}</p>
      )}
    </article>
  );
}

/**
 * Vídeo da semana da equipe: entregas, ajudas entre colegas, gêmeos em ação e trechos das telas novas. A semana é
 * da equipe: sem nota e sem ranking.
 */
export function VideoSemana({ videos }: { videos: TeamVideo[] }) {
  if (!videos.length) return null;
  return (
    <section className="card team-videos" aria-labelledby="video-semana">
      <h2 id="video-semana" className="card__title">
        Vídeo da semana
      </h2>
      <div className="team-videos__list">
        {videos.map((v) => (
          <TeamVideoItem key={v.id} v={v} />
        ))}
      </div>
      <p className="card__foot">Montado pelo Echo a partir dos relatórios da semana, com trechos das telas novas gravados por um agente Claude no preview. Sem nota e sem ranking: a semana é da equipe.</p>
    </section>
  );
}
