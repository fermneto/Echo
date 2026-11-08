"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { angleDeg, arcPoint, fibonacciLatLng, rotate, toVec, type Vec3 } from "./globeMath";
import { WORLD_MAP_PNG } from "./worldMap";

/**
 * Globo de pontos desenhado em canvas 2D. Os pontos são só os da terra (máscara do mundo).
 * Em volta de cada cidade, os próprios pontos do globo mudam de cor, verde onde há gente no
 * expediente e azul onde o gêmeo está no comando, com uma onda que pulsa saindo da cidade.
 * Arcos entre as pessoas com um brilho que corre; etiquetas acompanham cada ponto.
 * Passar o mouse num ponto (ou na etiqueta) abre o cartão daquele lugar, que fecha ao sair.
 * Sem hover (toque, teclado), abre com toque ou foco; fecha com Esc, toque fora ou ×.
 * Arrasta com inércia, gira sozinho, pausa fora da tela e respeita prefers-reduced-motion.
 */

type Tone = "on" | "twin" | "wait" | "ask";

export type GlobePoint = {
  id: string;
  location: [number, number];
  tone: "on" | "twin" | "wait";
  /** Raio, em graus, da área do globo tingida em volta do ponto; 0 desliga. */
  halo?: number;
  /** Lado da etiqueta em relação ao ponto. */
  side?: "left" | "right";
  label: ReactNode;
  /** Nome curto para leitores de tela ("Fortaleza"). */
  place: string;
  /** O que aparece ao clicar no ponto. */
  detail?: ReactNode;
  /** Etiqueta só aparece com o ponteiro em cima (para o globo não ficar poluído). */
  quiet?: boolean;
};

export type GlobeArc = { id: string; from: [number, number]; to: [number, number]; tone: Tone };

const RGB: Record<Tone, [number, number, number]> = {
  on: [152, 255, 56],
  twin: [77, 141, 255],
  wait: [224, 179, 84],
  ask: [250, 250, 250],
};
/** Quem está de férias é coberto pelo gêmeo: a área fica azul. */
const AREA: Record<GlobePoint["tone"], [number, number, number]> = { on: RGB.on, twin: RGB.twin, wait: RGB.twin };

const SAMPLES = 16_000;
const RAD = Math.PI / 180;

type Dot = { v: Vec3; area: number; dist: number };

function loadLand(): Promise<(lat: number, lng: number) => boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      if (!g) return resolve(() => false);
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      resolve((lat, lng) => {
        const x = Math.min(c.width - 1, Math.floor(((lng + 180) / 360) * c.width));
        const y = Math.min(c.height - 1, Math.floor(((90 - lat) / 180) * c.height));
        return (data[(y * c.width + x) * 4] ?? 0) > 128;
      });
    };
    img.src = WORLD_MAP_PNG;
  });
}

export function EchoGlobe({ points, arcs, focusLongitude = -5, theta = 0.32 }: { points: GlobePoint[]; arcs: GlobeArc[]; focusLongitude?: number; theta?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const popupRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const openRef = useRef<number | null>(null);
  openRef.current = open;
  // Fechar com um pequeno atraso dá tempo de levar o ponteiro do ponto até o cartão.
  const closeTimer = useRef(0);
  const show = (i: number) => {
    window.clearTimeout(closeTimer.current);
    setOpen(i);
  };
  const hideSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(null), 180);
  };
  const showRef = useRef(show);
  showRef.current = show;
  const hideRef = useRef(hideSoon);
  hideRef.current = hideSoon;

  /** Redesenha um quadro já (o globo parado, com movimento reduzido, não redesenha sozinho). */
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    const id = requestAnimationFrame(() => redraw.current());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Fecha com Esc ou clique fora do globo.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !wrap || !ctx) return;

    let disposed = false;
    let raf = 0;
    let visible = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let size = 0;
    let sphere: HTMLCanvasElement | null = null;

    let phi = focusLongitude * RAD;
    let tilt = theta;
    let drag: { x: number; y: number; phi: number; tilt: number } | null = null;
    let vel = { phi: 0, tilt: 0 };
    let lastMove: { x: number; y: number; t: number } | null = null;

    const cities = points.map((p) => ({ ...p, v: toVec(p.location[0], p.location[1]) }));
    /** Posição na tela de cada cidade no último quadro (para o clique). */
    const screen = cities.map(() => ({ x: 0, y: 0, z: -1 }));
    let hovered = -1;
    const arcVecs = arcs.map((a) => ({ ...a, a: toVec(a.from[0], a.from[1]), b: toVec(a.to[0], a.to[1]) }));
    let dots: Dot[] = [];

    const layout = () => {
      size = wrap.offsetWidth;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Esfera e brilho da borda desenhados uma vez.
      sphere = document.createElement("canvas");
      sphere.width = size * dpr;
      sphere.height = size * dpr;
      const s = sphere.getContext("2d");
      if (!s) return;
      s.setTransform(dpr, 0, 0, dpr, 0, 0);
      const c = size / 2;
      const r = size * 0.42;
      s.shadowColor = "rgba(255,255,255,0.08)";
      s.shadowBlur = size * 0.06;
      const g = s.createRadialGradient(c - r * 0.3, c - r * 0.35, r * 0.1, c, c, r);
      g.addColorStop(0, "#161616");
      g.addColorStop(1, "#070707");
      s.fillStyle = g;
      s.beginPath();
      s.arc(c, c, r, 0, Math.PI * 2);
      s.fill();
      s.shadowBlur = 0;
      s.strokeStyle = "rgba(255,255,255,0.07)";
      s.lineWidth = 1;
      s.stroke();
    };

    const draw = (t: number) => {
      const c = size / 2;
      const r = size * 0.42;
      const sec = t / 1000;
      ctx.clearRect(0, 0, size, size);
      if (sphere) ctx.drawImage(sphere, 0, 0, size, size);

      // Pontos da terra.
      const dotSize = Math.max(1.1, size * 0.0034);
      for (const d of dots) {
        const [x, y, z] = rotate(d.v, phi, tilt);
        if (z <= 0) continue;
        const shade = 0.25 + 0.75 * z;
        const sx = c + x * r;
        const sy = c - y * r;
        if (d.area >= 0) {
          const city = cities[d.area]!;
          const [cr, cg, cb] = AREA[city.tone];
          // Onda saindo da cidade: anéis que avançam com o tempo.
          const wave = reduce ? 0.9 : 0.62 + 0.38 * (0.5 + 0.5 * Math.cos(d.dist * 9 - sec * 3.2));
          const fade = 1 - d.dist * 0.35;
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${(shade * wave * fade).toFixed(3)})`;
          const k = dotSize * (1.1 + 0.3 * wave);
          ctx.fillRect(sx - k / 2, sy - k / 2, k, k);
        } else {
          ctx.fillStyle = `rgba(190,190,190,${(shade * 0.7).toFixed(3)})`;
          ctx.fillRect(sx - dotSize / 2, sy - dotSize / 2, dotSize, dotSize);
        }
      }

      // Arcos: traço fino e um brilho que corre de uma ponta à outra.
      ctx.lineCap = "round";
      arcVecs.forEach((a, i) => {
        const [ar, ag, ab] = RGB[a.tone];
        const lift = 0.06 + angleDeg(a.a, a.b) / 1100;
        const steps = 64;
        const pts: { x: number; y: number; on: boolean }[] = [];
        for (let k = 0; k <= steps; k++) {
          const [x, y, z] = rotate(arcPoint(a.a, a.b, k / steps, lift), phi, tilt);
          pts.push({ x: c + x * r, y: c - y * r, on: z > 0 || Math.hypot(x, y) > 1 });
        }
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.75)`;
        ctx.beginPath();
        pts.forEach((p, k) => {
          if (!p.on) return;
          if (k === 0 || !pts[k - 1]!.on) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        if (!reduce) {
          const head = Math.floor(((sec * 0.35 + i * 0.37) % 1) * steps);
          const from = Math.max(0, head - 6);
          ctx.lineWidth = 2.2;
          ctx.strokeStyle = `rgba(${ar},${ag},${ab},1)`;
          ctx.beginPath();
          for (let k = from; k <= head; k++) {
            const p = pts[k]!;
            if (!p.on) continue;
            if (k === from || !pts[k - 1]!.on) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
      });

      // Ponto de cada cidade com o anel que pulsa, e a etiqueta acompanhando.
      cities.forEach((p, i) => {
        const [x, y, z] = rotate(p.v, phi, tilt);
        const sx = c + x * r;
        const sy = c - y * r;
        screen[i] = { x: sx, y: sy, z };
        const label = labelRefs.current[i];
        const alpha = Math.max(0, Math.min(1, (z - 0.08) / 0.25));
        const isOpen = openRef.current === i;
        const shown = p.quiet ? (hovered === i ? alpha : 0) : alpha;
        if (label) {
          label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
          label.style.opacity = String(isOpen ? 0 : shown);
          label.style.pointerEvents = shown > 0.5 && !isOpen ? "auto" : "none";
        }
        const popup = popupRef.current;
        if (isOpen && popup) {
          popup.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
          popup.style.opacity = String(Math.max(0.15, alpha));
          popup.dataset.side = sx > c ? "left" : "right";
        }
        if (z <= 0) return;
        const [pr, pg, pb] = RGB[p.tone];
        if (!reduce) {
          const f = (sec * 0.6 + i * 0.25) % 1;
          ctx.strokeStyle = `rgba(${pr},${pg},${pb},${((1 - f) * 0.8 * alpha).toFixed(3)})`;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(sx, sy, 5 + f * 16, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(${pr},${pg},${pb},${Math.max(0.3, alpha).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, isOpen ? 7 : p.quiet ? 4 : 5, 0, Math.PI * 2);
        ctx.fill();
        if (isOpen) {
          ctx.strokeStyle = "rgba(250,250,250,0.9)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
    };

    redraw.current = () => {
      if (dots.length) draw(performance.now());
    };

    const tick = (t: number) => {
      if (!drag) {
        if (!reduce) phi += 0.0016;
        if (Math.abs(vel.phi) > 0.0001 || Math.abs(vel.tilt) > 0.0001) {
          phi += vel.phi;
          tilt += vel.tilt;
          vel = { phi: vel.phi * 0.95, tilt: vel.tilt * 0.95 };
        }
        // Volta devagar para uma inclinação confortável.
        if (tilt < theta - 0.4) tilt += (theta - 0.4 - tilt) * 0.1;
        if (tilt > theta + 0.4) tilt += (theta + 0.4 - tilt) * 0.1;
      }
      draw(t);
      if (visible && !disposed) raf = requestAnimationFrame(tick);
    };

    loadLand().then((isLand) => {
      if (disposed) return;
      dots = fibonacciLatLng(SAMPLES)
        .filter(([lat, lng]) => isLand(lat, lng))
        .map(([lat, lng]) => {
          const v = toVec(lat, lng);
          let area = -1;
          let dist = 1;
          cities.forEach((p, i) => {
            if (!p.halo) return;
            const d = angleDeg(v, p.v) / p.halo;
            if (d <= 1 && d < dist) {
              area = i;
              dist = d;
            }
          });
          return { v, area, dist };
        });
      layout();
      setReady(true);
      if (reduce) draw(0);
      else raf = requestAnimationFrame(tick);
    });

    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = Boolean(entry?.isIntersecting);
      if (visible && !was && dots.length && !reduce) raf = requestAnimationFrame(tick);
      if (!visible) cancelAnimationFrame(raf);
    });
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      if (!dots.length) return;
      layout();
      if (reduce) draw(0);
    });
    ro.observe(wrap);

    let downAt: { x: number; y: number } | null = null;
    /** Cidade sob o ponteiro (raio de 16 px), visível na face da frente. */
    const hit = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      const x = e.clientX - b.left;
      const y = e.clientY - b.top;
      let best = -1;
      let bestD = 16;
      screen.forEach((p, i) => {
        if (p.z <= 0.05 || !cities[i]?.detail) return;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      });
      return best;
    };
    const onHover = (e: PointerEvent) => {
      if (drag || e.pointerType === "touch") return;
      const was = hovered;
      hovered = hit(e);
      canvas.style.cursor = hovered >= 0 ? "pointer" : "grab";
      if (hovered !== was) {
        if (hovered >= 0) showRef.current(hovered);
        else hideRef.current();
      }
      if (reduce) draw(performance.now());
    };
    const onLeave = (e: PointerEvent) => {
      // Indo para o cartão ou para uma etiqueta: eles cuidam do próprio hover. O React avisa a
      // entrada neles antes deste "saiu do canvas", então fechar aqui desfaria a entrada.
      const to = e.relatedTarget as Node | null;
      const intoOverlay = to !== null && wrap.contains(to) && to !== canvas;
      if (hovered >= 0 && !intoOverlay) hideRef.current();
      hovered = -1;
      if (reduce) draw(performance.now());
    };
    /** Toque: abre e fecha o cartão, já que não há hover. */
    const onClick = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 8) return;
      const i = hit(e);
      setOpen((cur) => (i < 0 ? null : cur === i ? null : i));
    };
    const onDown = (e: PointerEvent) => {
      downAt = { x: e.clientX, y: e.clientY };
      drag = { x: e.clientX, y: e.clientY, phi, tilt };
      vel = { phi: 0, tilt: 0 };
      lastMove = null;
      canvas.style.cursor = "grabbing";
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      // O globo acompanha o ponteiro.
      phi = drag.phi - ((e.clientX - drag.x) / size) * Math.PI;
      tilt = drag.tilt + ((e.clientY - drag.y) / size) * 0.8;
      const now = performance.now();
      if (lastMove) {
        const dt = Math.max(now - lastMove.t, 1);
        const cap = (v: number) => Math.max(-0.08, Math.min(0.08, v));
        vel = { phi: cap((-(e.clientX - lastMove.x) / size) * Math.PI * (16 / dt)), tilt: cap(((e.clientY - lastMove.y) / size) * 0.8 * (16 / dt)) };
      }
      lastMove = { x: e.clientX, y: e.clientY, t: now };
      if (reduce) draw(0);
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      canvas.style.cursor = "grab";
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onHover);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerup", onClick);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onHover);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerup", onClick);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [points, arcs, focusLongitude, theta]);

  return (
    <div className="globe" ref={wrapRef}>
      <canvas ref={canvasRef} className={`globe__canvas${ready ? " is-ready" : ""}`} aria-label="Globo com a equipe em Fortaleza, Joanesburgo e Tóquio" role="img" />
      {points.map((p, i) => (
        <button
          key={p.id}
          type="button"
          ref={(el) => {
            labelRefs.current[i] = el;
          }}
          className={`globe__label globe__label--${p.tone}${p.side === "left" ? " globe__label--left" : ""}`}
          aria-label={`Ver o que acontece em ${p.place}`}
          aria-expanded={open === i}
          onPointerEnter={(e) => e.pointerType !== "touch" && show(i)}
          onPointerLeave={(e) => e.pointerType !== "touch" && hideSoon()}
          onFocus={() => show(i)}
          onBlur={hideSoon}
          onClick={() => setOpen((cur) => (cur === i ? null : i))}
        >
          {p.label}
        </button>
      ))}
      {open !== null && points[open]?.detail && (
        <div
          ref={popupRef}
          className="globe__popup"
          role="dialog"
          aria-label={`Conversa em ${points[open]!.place}`}
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onPointerLeave={(e) => e.pointerType !== "touch" && hideSoon()}
        >
          <div className="globe__popup-card">
            <button type="button" className="globe__close" onClick={() => setOpen(null)} aria-label="Fechar">
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {points[open]!.detail}
          </div>
        </div>
      )}
    </div>
  );
}
