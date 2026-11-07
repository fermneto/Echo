"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/**
 * Leque de cartões em 3D: o ativo fica à frente e levantado, os vizinhos se abrem em arco,
 * inclinados e mais fundos. Avança sozinho, pausa com o mouse em cima ou com foco, e aceita
 * clique, setas do teclado e arrastar. Transições só em CSS; com movimento reduzido, não
 * avança sozinho e troca sem animação.
 */

export type StackItem = { id: string; title: string; content: ReactNode };

/** Menor deslocamento com sinal de i até o ativo, dando a volta no fim da lista. */
export function signedOffset(i: number, active: number, len: number): number {
  const raw = i - active;
  if (len <= 1) return raw;
  const alt = raw > 0 ? raw - len : raw + len;
  return Math.abs(alt) < Math.abs(raw) ? alt : raw;
}

const wrap = (n: number, len: number) => ((n % len) + len) % len;

export function CardStack({
  items,
  maxVisible = 5,
  overlap = 0.5,
  spreadDeg = 30,
  depthPx = 120,
  tiltXDeg = 10,
  intervalMs = 3800,
  label,
}: {
  items: StackItem[];
  maxVisible?: number;
  overlap?: number;
  spreadDeg?: number;
  depthPx?: number;
  tiltXDeg?: number;
  intervalMs?: number;
  label: string;
}) {
  const len = items.length;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [width, setWidth] = useState(460);
  const stage = useRef<HTMLDivElement>(null);
  const dragX = useRef<number | null>(null);

  const next = useCallback(() => setActive((a) => wrap(a + 1, len)), [len]);
  const prev = useCallback(() => setActive((a) => wrap(a - 1, len)), [len]);

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(460, Math.round(el.offsetWidth * 0.84))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (reduce || paused || len < 2) return;
    const id = window.setInterval(next, Math.max(1500, intervalMs));
    return () => window.clearInterval(id);
  }, [reduce, paused, len, intervalMs, next, active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") (e.preventDefault(), prev());
    if (e.key === "ArrowRight") (e.preventDefault(), next());
  };

  const maxOffset = Math.floor(maxVisible / 2);
  const spacing = Math.round(width * (1 - overlap));
  const stepDeg = maxOffset ? spreadDeg / maxOffset : 0;

  return (
    <div
      className={`stack${reduce ? " is-still" : ""}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        ref={stage}
        className="stack__stage"
        tabIndex={0}
        role="region"
        aria-roledescription="carrossel"
        aria-label={label}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          dragX.current = e.clientX;
        }}
        onPointerUp={(e) => {
          if (dragX.current === null) return;
          const travel = e.clientX - dragX.current;
          dragX.current = null;
          if (travel > 60) prev();
          else if (travel < -60) next();
        }}
        onPointerCancel={() => {
          dragX.current = null;
        }}
      >
        {items.map((item, i) => {
          const off = signedOffset(i, active, len);
          const abs = Math.abs(off);
          const isActive = off === 0;
          const hidden = abs > maxOffset;
          const transform = [
            `translateX(${off * spacing}px)`,
            `translateY(${abs * 12 + (isActive ? -18 : 0)}px)`,
            `translateZ(${-abs * depthPx}px)`,
            `rotateZ(${off * stepDeg}deg)`,
            `rotateX(${isActive ? 0 : tiltXDeg}deg)`,
            `scale(${isActive ? 1.02 : 0.93})`,
          ].join(" ");
          return (
            <div
              key={item.id}
              className={`stack__card${isActive ? " is-active" : ""}`}
              style={{ width, transform, zIndex: 100 - abs, opacity: hidden ? 0 : 1, pointerEvents: hidden ? "none" : undefined } as CSSProperties}
              aria-hidden={!isActive}
              onClick={() => !isActive && setActive(i)}
            >
              {item.content}
            </div>
          );
        })}
      </div>

      <div className="stack__nav">
        <button type="button" className="stack__arrow" onClick={prev} aria-label="Momento anterior">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="stack__dots">
          {items.map((it, idx) => (
            <button key={it.id} type="button" className={`stack__dot${idx === active ? " is-on" : ""}`} onClick={() => setActive(idx)} aria-label={it.title} aria-current={idx === active ? "step" : undefined} />
          ))}
        </div>
        <button type="button" className="stack__arrow" onClick={next} aria-label="Próximo momento">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {items[active]?.title}
      </p>
    </div>
  );
}
