"use client";

import createGlobe, { type Arc, type Marker } from "cobe";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Globo de pontos em WebGL (cobe) com a equipe da demo: marcadores pela cor do estado,
 * arcos entre as pessoas e etiquetas presas a cada ponto por CSS anchor positioning.
 * Arrasta com inércia, gira sozinho, pausa fora da tela e respeita prefers-reduced-motion.
 */

type RGB = [number, number, number];

export type GlobePoint = {
  id: string;
  location: [number, number];
  tone: "on" | "twin" | "wait";
  label: ReactNode;
};

export type GlobeArc = {
  id: string;
  from: [number, number];
  to: [number, number];
  tone: "on" | "twin" | "ask";
};

const TONE: Record<GlobePoint["tone"] | GlobeArc["tone"], RGB> = {
  on: [0.596, 1, 0.22],
  twin: [0.302, 0.553, 1],
  wait: [0.878, 0.702, 0.329],
  ask: [0.98, 0.98, 0.98],
};

/** Ângulos do cobe para deixar uma longitude de frente. */
const phiFor = (longitude: number) => Math.PI - ((longitude * Math.PI) / 180 - Math.PI / 2);

export function EchoGlobe({ points, arcs, focusLongitude = -5, theta = 0.22 }: { points: GlobePoint[]; arcs: GlobeArc[]; focusLongitude?: number; theta?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  // Estado de rotação fora do React: muda a cada quadro.
  const phi = useRef(phiFor(focusLongitude));
  const thetaOffset = useRef(0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const dragDelta = useRef({ phi: 0, theta: 0 });
  const velocity = useRef({ phi: 0, theta: 0 });
  const last = useRef<{ x: number; t: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 640 ? 1.8 : 2);
    let size = wrap.offsetWidth;
    let visible = true;
    let raf = 0;

    const markers: Marker[] = points.map((p) => ({ id: p.id, location: p.location, size: 0.045, color: TONE[p.tone] }));
    const cobeArcs: Arc[] = arcs.map((a) => ({ id: a.id, from: a.from, to: a.to, color: TONE[a.tone] }));

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: size * dpr,
      height: size * dpr,
      phi: phi.current,
      theta,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16_000,
      mapBrightness: 7,
      mapBaseBrightness: 0.02,
      baseColor: [0.14, 0.14, 0.14],
      markerColor: TONE.twin,
      glowColor: [0.08, 0.08, 0.08],
      opacity: 0.9,
      markers,
      arcs: cobeArcs,
      arcColor: TONE.twin,
      arcWidth: 0.6,
      arcHeight: 0.28,
      markerElevation: 0.02,
    });

    const tick = () => {
      if (!drag.current) {
        if (!reduce) phi.current += 0.0016;
        if (Math.abs(velocity.current.phi) > 0.0001 || Math.abs(velocity.current.theta) > 0.0001) {
          phi.current += velocity.current.phi;
          thetaOffset.current += velocity.current.theta;
          velocity.current.phi *= 0.95;
          velocity.current.theta *= 0.95;
        }
        // Volta devagar para a faixa de inclinação confortável.
        const t = thetaOffset.current;
        if (t < -0.35) thetaOffset.current += (-0.35 - t) * 0.1;
        if (t > 0.35) thetaOffset.current += (0.35 - t) * 0.1;
      }
      globe.update({
        phi: phi.current + dragDelta.current.phi,
        theta: theta + thetaOffset.current + dragDelta.current.theta,
        width: size * dpr,
        height: size * dpr,
      });
      if (visible) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const show = window.setTimeout(() => setReady(true), 60);

    const io = new IntersectionObserver(([entry]) => {
      const was = visible;
      visible = Boolean(entry?.isIntersecting);
      if (visible && !was) raf = requestAnimationFrame(tick);
      if (!visible) cancelAnimationFrame(raf);
    });
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      size = wrap.offsetWidth;
    });
    ro.observe(wrap);

    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      dragDelta.current = { phi: (e.clientX - drag.current.x) / 300, theta: (e.clientY - drag.current.y) / 1000 };
      const now = performance.now();
      if (last.current) {
        const dt = Math.max(now - last.current.t, 1);
        const cap = (v: number) => Math.max(-0.15, Math.min(0.15, v));
        velocity.current = { phi: cap(((e.clientX - last.current.x) / dt) * 0.3), theta: cap(((e.clientY - last.current.y) / dt) * 0.08) };
      }
      last.current = { x: e.clientX, y: e.clientY, t: now };
    };
    const onUp = () => {
      if (!drag.current) return;
      phi.current += dragDelta.current.phi;
      thetaOffset.current += dragDelta.current.theta;
      dragDelta.current = { phi: 0, theta: 0 };
      drag.current = null;
      last.current = null;
      canvas.style.cursor = "grab";
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(show);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      globe.destroy();
    };
  }, [points, arcs, theta]);

  return (
    <div className="globe" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className={`globe__canvas${ready ? " is-ready" : ""}`}
        aria-label="Globo com a equipe da demonstração em Fortaleza, Joanesburgo e Tóquio"
        role="img"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          velocity.current = { phi: 0, theta: 0 };
          e.currentTarget.style.cursor = "grabbing";
        }}
      />
      {points.map((p) => (
        <div
          key={p.id}
          className="globe__label"
          aria-hidden="true"
          style={
            {
              positionAnchor: `--cobe-${p.id}`,
              opacity: `var(--cobe-visible-${p.id}, 0)`,
              filter: `blur(calc((1 - var(--cobe-visible-${p.id}, 0)) * 8px))`,
            } as CSSProperties
          }
        >
          {p.label}
        </div>
      ))}
    </div>
  );
}
