"use client";

import { useEffect, useRef } from "react";

/**
 * Campo de pontos atrás do herói. A maioria fica quase apagada; alguns acendem e apagam
 * em verde (alguém trabalhando), azul (um agente) ou cinza, cada um no seu ritmo.
 * Pausa fora da tela; com movimento reduzido, desenha uma vez e para.
 */

const GAP = 24;
const COLORS = {
  on: [152, 255, 56],
  twin: [77, 141, 255],
  gray: [161, 161, 161],
} as const;

type Live = { x: number; y: number; rgb: readonly number[]; period: number; phase: number; peak: number };

/** Gerador determinístico: o campo sai igual a cada carga. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function DotField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let live: Live[] = [];
    let raf = 0;
    let visible = true;
    let last = 0;

    const layout = () => {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const rand = rng(7);
      live = [];
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const r = rand();
          // Mais vida à direita, onde fica o globo.
          const chance = 0.04 + 0.1 * (x / w);
          if (r < chance) {
            const k = rand();
            live.push({ x, y, rgb: k < 0.45 ? COLORS.on : k < 0.85 ? COLORS.twin : COLORS.gray, period: 2.2 + rand() * 3.5, phase: rand() * Math.PI * 2, peak: 0.45 + rand() * 0.55 });
          }
        }
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(255,255,255,0.075)";
      for (let y = GAP / 2; y < h; y += GAP) for (let x = GAP / 2; x < w; x += GAP) ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
      for (const d of live) {
        const a = reduce ? d.peak * 0.6 : d.peak * Math.max(0, Math.sin((t / 1000) * ((2 * Math.PI) / d.period) + d.phase)) ** 2;
        if (a < 0.02) continue;
        ctx.fillStyle = `rgba(${d.rgb[0]},${d.rgb[1]},${d.rgb[2]},${a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const tick = (t: number) => {
      // ~30 quadros por segundo bastam para um pulso lento.
      if (t - last > 33) {
        draw(t);
        last = t;
      }
      if (visible) raf = requestAnimationFrame(tick);
    };

    layout();
    if (reduce) draw(0);
    else raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      layout();
      if (reduce) draw(0);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = Boolean(e?.isIntersecting);
      if (!reduce && visible && !was) raf = requestAnimationFrame(tick);
      if (!visible) cancelAnimationFrame(raf);
    });
    io.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="lp-field" aria-hidden="true" />;
}
