"use client";

import createGlobe, { type Arc, type Marker } from "cobe";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Globo de pontos em WebGL (cobe) com a equipe da demo.
 * - Cada cidade tem um halo de pontos pulsantes: verde onde há gente no expediente,
 *   azul onde o gêmeo está no comando. O ponto da cidade pulsa maior.
 * - Arcos entre as pessoas e etiquetas presas a cada ponto por CSS anchor positioning.
 * Arrasta com inércia, gira sozinho, pausa fora da tela e respeita prefers-reduced-motion.
 */

type RGB = [number, number, number];
type Tone = "on" | "twin" | "wait" | "ask";

export type GlobePoint = {
  id: string;
  location: [number, number];
  tone: "on" | "twin" | "wait";
  /** Raio do halo em graus; 0 desliga. */
  halo?: number;
  /** Lado da etiqueta em relação ao ponto. */
  side?: "left" | "right";
  label: ReactNode;
};

export type GlobeArc = { id: string; from: [number, number]; to: [number, number]; tone: Tone };

const TONE: Record<Tone, RGB> = {
  on: [0.596, 1, 0.22],
  twin: [0.302, 0.553, 1],
  wait: [0.878, 0.702, 0.329],
  ask: [0.98, 0.98, 0.98],
};

/** O halo de quem está de férias é do gêmeo: azul. */
const HALO_TONE: Record<GlobePoint["tone"], RGB> = { on: TONE.on, twin: TONE.twin, wait: TONE.twin };

const phiFor = (longitude: number) => Math.PI - ((longitude * Math.PI) / 180 - Math.PI / 2);

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

type HaloDot = { location: [number, number]; base: number; phase: number; period: number; color: RGB };

/** Pontos numa grade de 1,5° dentro do raio, mais densos e maiores perto do centro. */
function haloFor(p: GlobePoint, seed: number): HaloDot[] {
  const radius = p.halo ?? 0;
  if (!radius) return [];
  const rand = rng(seed);
  const dots: HaloDot[] = [];
  const [lat0, lng0] = p.location;
  const step = 1.5;
  for (let dLat = -radius; dLat <= radius; dLat += step) {
    for (let dLng = -radius; dLng <= radius; dLng += step) {
      const dist = Math.hypot(dLat, dLng) / radius;
      if (dist > 1 || dist < 0.18) continue;
      if (rand() < dist * dist * 0.7) continue; // rareia na borda
      const lat = lat0 + dLat + (rand() - 0.5) * 0.25;
      const lng = lng0 + dLng / Math.cos((lat0 * Math.PI) / 180) + (rand() - 0.5) * 0.25;
      dots.push({ location: [lat, lng], base: 0.011 * (1 - dist * 0.4), phase: rand() * Math.PI * 2, period: 1.8 + rand() * 2.4, color: HALO_TONE[p.tone] });
    }
  }
  return dots;
}

export function EchoGlobe({ points, arcs, focusLongitude = -5, theta = 0.22 }: { points: GlobePoint[]; arcs: GlobeArc[]; focusLongitude?: number; theta?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

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

    const halos = points.flatMap((p, i) => haloFor(p, 11 + i * 97));
    const markersAt = (t: number): Marker[] => {
      const s = t / 1000;
      const halo = halos.map((d) => ({
        location: d.location,
        size: reduce ? d.base : d.base * (0.6 + 0.4 * Math.sin(s * ((2 * Math.PI) / d.period) + d.phase)),
        color: d.color,
      }));
      const main = points.map((p) => ({
        id: p.id,
        location: p.location,
        size: reduce ? 0.05 : 0.045 + 0.012 * Math.sin(s * 2.2 + p.location[1]),
        color: TONE[p.tone],
      }));
      return [...halo, ...main];
    };
    const cobeArcs: Arc[] = arcs.map((a) => ({ id: a.id, from: a.from, to: a.to, color: TONE[a.tone] }));

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: size * dpr,
      height: size * dpr,
      phi: phi.current,
      theta,
      dark: 1,
      diffuse: 1.15,
      mapSamples: 22_000,
      mapBrightness: 6.5,
      mapBaseBrightness: 0.015,
      baseColor: [0.12, 0.12, 0.12],
      markerColor: TONE.twin,
      glowColor: [0.1, 0.1, 0.11],
      opacity: 0.92,
      markers: markersAt(0),
      arcs: cobeArcs,
      arcColor: TONE.twin,
      arcWidth: 0.6,
      arcHeight: 0.3,
      markerElevation: 0.01,
    });

    const tick = (t: number) => {
      if (!drag.current) {
        if (!reduce) phi.current += 0.0016;
        if (Math.abs(velocity.current.phi) > 0.0001 || Math.abs(velocity.current.theta) > 0.0001) {
          phi.current += velocity.current.phi;
          thetaOffset.current += velocity.current.theta;
          velocity.current.phi *= 0.95;
          velocity.current.theta *= 0.95;
        }
        const th = thetaOffset.current;
        if (th < -0.35) thetaOffset.current += (-0.35 - th) * 0.1;
        if (th > 0.35) thetaOffset.current += (0.35 - th) * 0.1;
      }
      globe.update({
        phi: phi.current + dragDelta.current.phi,
        theta: theta + thetaOffset.current + dragDelta.current.theta,
        width: size * dpr,
        height: size * dpr,
        ...(reduce ? {} : { markers: markersAt(t) }),
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
          className={`globe__label globe__label--${p.tone}${p.side === "left" ? " globe__label--left" : ""}`}
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
