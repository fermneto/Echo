"use client";

import { useEffect, useRef } from "react";

/**
 * Pontilhado atrás do herói: uma onda que sai do globo e se espalha pela página.
 * Os anéis acendem os pontos da grade ao passar; perto do globo a onda é verde e azul,
 * e vai ficando cinza e fraca com a distância. Pausa fora da tela; com movimento
 * reduzido, desenha um anel parado.
 */

const GAP = 22;
const ON = [152, 255, 56];
const TWIN = [77, 141, 255];
const GRAY = [200, 200, 200];

/** Mistura determinística por posição: cada ponto tem sempre a mesma cor. */
function hash(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export function DotField({ origin = ".globe" }: { origin?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let ox = 0;
    let oy = 0;
    let r0 = 0;
    let raf = 0;
    let visible = true;
    let last = 0;
    let grid: { x: number; y: number; d: number; tint: number[] | null }[] = [];

    const layout = () => {
      w = canvas.offsetWidth;
      h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Centro do globo, em coordenadas deste canvas.
      const g = document.querySelector(origin)?.getBoundingClientRect();
      const me = canvas.getBoundingClientRect();
      ox = g ? g.left + g.width / 2 - me.left : w * 0.72;
      oy = g ? g.top + g.height / 2 - me.top : h * 0.45;
      r0 = g ? g.width * 0.42 : 240;
      grid = [];
      for (let y = GAP / 2; y < h; y += GAP) {
        for (let x = GAP / 2; x < w; x += GAP) {
          const d = Math.hypot(x - ox, y - oy);
          if (d < r0 + 6) continue; // o globo cobre esta área
          const k = hash(x, y);
          grid.push({ x, y, d, tint: k < 0.16 ? ON : k < 0.32 ? TWIN : null });
        }
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const sec = t / 1000;
      const speed = 90; // px por segundo
      const wavelength = 170;
      for (const p of grid) {
        const out = p.d - r0;
        // Anel: pico estreito que viaja para fora.
        const phase = reduce ? out / wavelength : (out - sec * speed) / wavelength;
        const ring = Math.pow(0.5 + 0.5 * Math.cos(phase * Math.PI * 2), 5);
        const reach = Math.exp(-out / 760);
        const a = 0.06 + ring * reach * 0.85;
        // A cor da onda some com a distância; longe, só cinza.
        const tinted = p.tint && ring * reach > 0.12;
        const rgb = tinted ? p.tint! : GRAY;
        ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${(tinted ? a : a * 0.55).toFixed(3)})`;
        const s = 1.3 + ring * reach * 1.1;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    };

    const tick = (t: number) => {
      if (t - last > 33) {
        draw(t);
        last = t;
      }
      if (visible) raf = requestAnimationFrame(tick);
    };

    // Espera o layout do herói assentar antes de medir o globo.
    const start = window.setTimeout(() => {
      layout();
      if (reduce) draw(0);
      else raf = requestAnimationFrame(tick);
    }, 50);

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
      window.clearTimeout(start);
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [origin]);

  return <canvas ref={ref} className="lp-field" aria-hidden="true" />;
}
