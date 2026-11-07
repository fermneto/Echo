"use client";

import { useEffect, useRef } from "react";
import { WORLD_MAP_PNG } from "./landing/worldMap";
import { PixelSprite, type SpriteMode } from "./PixelSprite";

/**
 * Mapa-múndi plano de pontos com a equipe: terra em pontos, mais apagada onde é noite agora,
 * pontos coloridos em volta de cada cidade (verde: alguém no expediente; azul: gêmeo cobrindo),
 * faixas de fuso com a hora local, bonequinhos e arcos tracejados do gêmeo até quem pergunta.
 */

export type MapCrew = {
  key: string;
  location: [number, number];
  tone: "on" | "twin" | "wait";
  label: string;
  people: { id: string; mode: SpriteMode; hair: "short" | "long" | "curly" | "bun" | "square" }[];
};
export type MapZone = { lng: number; label: string };
export type MapArc = { from: string; to: string; tone: "on" | "twin" };

const TOP = 75;
const BOTTOM = -58;
const SPAN = TOP - BOTTOM;
const STEP = 1.7; // graus entre pontos
const RGB = { on: [152, 255, 56], twin: [77, 141, 255], wait: [224, 179, 84] } as const;

const x = (lng: number) => (lng + 180) / 360;
const y = (lat: number) => (TOP - lat) / SPAN;

export function WorldMap({ crews, zones, arcs, nowIso }: { crews: MapCrew[]; zones: MapZone[]; arcs: MapArc[]; nowIso: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    const ctx = el?.getContext("2d");
    if (!el || !box || !ctx) return;
    const now = new Date(nowIso);
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    let land: ((lat: number, lng: number) => boolean) | null = null;

    const draw = () => {
      if (!land) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = box.offsetWidth;
      const h = (w * SPAN) / 360;
      el.width = w * dpr;
      el.height = h * dpr;
      el.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const r = Math.max(0.9, w / 900);
      for (let lat = TOP - STEP / 2; lat > BOTTOM; lat -= STEP) {
        for (let lng = -180 + STEP / 2; lng < 180; lng += STEP) {
          if (!land(lat, lng)) continue;
          // Hora solar local: noite entre 18h e 6h deixa o ponto mais apagado.
          const solar = (((utcHours + lng / 15) % 24) + 24) % 24;
          const night = solar < 6 || solar >= 18;
          let rgb: readonly number[] = [170, 170, 170];
          let a = night ? 0.22 : 0.55;
          for (const c of crews) {
            const d = Math.hypot(lat - c.location[0], (lng - c.location[1]) * Math.cos((lat * Math.PI) / 180));
            if (d < 9) {
              rgb = RGB[c.tone === "wait" ? "twin" : c.tone];
              a = 0.9 - (d / 9) * 0.55;
              break;
            }
          }
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(x(lng) * w, y(lat) * h, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      if (!g) return;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      land = (lat, lng) => {
        const px = Math.min(c.width - 1, Math.floor(((lng + 180) / 360) * c.width));
        const py = Math.min(c.height - 1, Math.floor(((90 - lat) / 180) * c.height));
        return (data[(py * c.width + px) * 4] ?? 0) > 128;
      };
      draw();
    };
    img.src = WORLD_MAP_PNG;
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    return () => ro.disconnect();
  }, [crews, nowIso]);

  const at = (key: string) => crews.find((c) => c.key === key);

  return (
    <figure className="wmap" ref={wrap} aria-label="Mapa da equipe por fuso">
      <canvas ref={canvas} className="wmap__canvas" aria-hidden="true" />

      {zones.map((z) => (
        <span key={z.label} className="wmap__zone" style={{ left: `${x(z.lng) * 100}%` }} aria-hidden="true">
          <span className="wmap__zone-label">{z.label}</span>
        </span>
      ))}

      <svg className="wmap__arcs" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
        {arcs.map((a) => {
          const f = at(a.from);
          const t = at(a.to);
          if (!f || !t) return null;
          const x1 = x(f.location[1]) * 1000;
          const y1 = y(f.location[0]) * 1000;
          const x2 = x(t.location[1]) * 1000;
          const y2 = y(t.location[0]) * 1000;
          const cx = (x1 + x2) / 2;
          const cy = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.35;
          return <path key={a.from + a.to} className={`wmap__arc wmap__arc--${a.tone}`} d={`M${x1},${y1} Q${cx},${cy} ${x2},${y2}`} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>

      {crews.map((c) => (
        <div key={c.key} className={`wmap__crew wmap__crew--${c.tone}${x(c.location[1]) > 0.82 ? " is-flipped" : ""}`} style={{ left: `${x(c.location[1]) * 100}%`, top: `${y(c.location[0]) * 100}%` }}>
          <span className="wmap__people" aria-hidden="true">
            {c.people.map((p) => (
              <PixelSprite key={p.id} look={{ hair: p.hair }} mode={p.mode} size={22} />
            ))}
          </span>
          <span className="wmap__dot" aria-hidden="true" />
          <span className="wmap__label mono">{c.label}</span>
        </div>
      ))}
    </figure>
  );
}
