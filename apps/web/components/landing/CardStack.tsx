"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/**
 * Leque de cartões em 3D: o ativo fica à frente e levantado, os vizinhos se abrem em arco,
 * inclinados e mais fundos. Os cartões acompanham o ponteiro ao arrastar e encaixam no mais
 * próximo ao soltar; a rolagem (roda do mouse ou trackpad) também passa os cartões.
 * Avança sozinho, pausa com o mouse em cima ou com foco, e aceita clique, setas e pontos.
 * Transições só em CSS; com movimento reduzido, não avança sozinho e troca sem animação.
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

/** Quantos cartões andar ao soltar um arrasto: pela distância e um empurrão pela velocidade. */
export function stepsForDrag(dx: number, spacing: number, velocityPxPerMs: number): number {
  const fling = Math.abs(velocityPxPerMs) > 0.6 ? Math.sign(velocityPxPerMs) * 0.6 : 0;
  return -Math.round(dx / spacing + fling);
}

const WHEEL_STEP = 80; // px de rolagem por cartão
const WHEEL_COOLDOWN = 260; // ms entre trocas pela roda

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
  /** Deslocamento do arrasto, em cartões (fracionário enquanto arrasta). */
  const [shift, setShift] = useState(0);
  const [dragging, setDragging] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; lastX: number; lastT: number; v: number; moved: boolean } | null>(null);
  const spacingRef = useRef(230);
  /** Acabou de arrastar: o clique que vem junto com o soltar é ignorado. */
  const justDragged = useRef(false);

  const go = useCallback((n: number) => setActive((a) => wrap(a + n, len)), [len]);
  const next = useCallback(() => go(1), [go]);
  const prev = useCallback(() => go(-1), [go]);

  useEffect(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.min(460, Math.round(el.offsetWidth * 0.84))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Só o gesto horizontal (trackpad ou Shift + roda) troca de cartão; o vertical rola a página.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let acc = 0;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const d = horizontal ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!d) return;
      e.preventDefault();
      acc += d;
      const now = performance.now();
      if (Math.abs(acc) >= WHEEL_STEP && now - last > WHEEL_COOLDOWN) {
        go(acc > 0 ? 1 : -1);
        acc = 0;
        last = now;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [go]);

  useEffect(() => {
    if (reduce || paused || dragging || len < 2) return;
    const id = window.setInterval(next, Math.max(1500, intervalMs));
    return () => window.clearInterval(id);
  }, [reduce, paused, dragging, len, intervalMs, next, active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") (e.preventDefault(), prev());
    if (e.key === "ArrowRight") (e.preventDefault(), next());
  };

  const maxOffset = Math.floor(maxVisible / 2);
  const spacing = Math.round(width * (1 - overlap));
  spacingRef.current = spacing;
  const stepDeg = maxOffset ? spreadDeg / maxOffset : 0;

  return (
    <div
      className={`stack${reduce ? " is-still" : ""}${dragging ? " is-dragging" : ""}`}
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
        aria-label={`${label}. Arraste, role ou use as setas.`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
          // Movimento mais vertical que horizontal é rolagem da página: o carrossel não reage.
          if (!d.moved && Math.abs(dy) >= Math.abs(dx)) {
            drag.current = null;
            return;
          }
          if (!d.moved) {
            // Só captura o ponteiro quando vira arrasto, para o clique simples chegar ao cartão.
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
          }
          d.moved = true;
          const now = performance.now();
          d.v = (e.clientX - d.lastX) / Math.max(1, now - d.lastT);
          d.lastX = e.clientX;
          d.lastT = now;
          setShift(-dx / spacingRef.current);
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          if (d.moved) {
            const n = stepsForDrag(e.clientX - d.x, spacingRef.current, d.v);
            if (n) go(n);
            justDragged.current = true;
            window.setTimeout(() => (justDragged.current = false), 0);
          }
          setShift(0);
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setShift(0);
          setDragging(false);
        }}
        onClickCapture={(e) => {
          // Um arrasto não vira clique num cartão vizinho.
          if (justDragged.current) e.stopPropagation();
        }}
      >
        {items.map((item, i) => {
          const off = signedOffset(i, active, len) - shift;
          const abs = Math.abs(off);
          const near = Math.min(1, abs); // 0 = à frente, 1 = vizinho
          const isActive = abs < 0.5;
          const hidden = abs > maxOffset + 0.5;
          const transform = [
            `translateX(${off * spacing}px)`,
            `translateY(${abs * 12 - (1 - near) * 18}px)`,
            `translateZ(${-abs * depthPx}px)`,
            `rotateZ(${off * stepDeg}deg)`,
            `rotateX(${near * tiltXDeg}deg)`,
            `scale(${1.02 - near * 0.09})`,
          ].join(" ");
          return (
            <div
              key={item.id}
              className={`stack__card${isActive ? " is-active" : ""}`}
              style={{ width, transform, zIndex: 100 - Math.round(abs * 2), opacity: hidden ? 0 : 1, pointerEvents: hidden ? "none" : undefined } as CSSProperties}
              aria-hidden={!isActive}
              onClick={() => !isActive && go(signedOffset(i, active, len))}
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
