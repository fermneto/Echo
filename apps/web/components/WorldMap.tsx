"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { WORLD_MAP_PNG } from "./landing/worldMap";
import { PixelSprite, type SpriteMode } from "./PixelSprite";

/**
 * Mapa-múndi plano de pontos com a equipe: terra em pontos, mais apagada onde é noite agora,
 * pontos coloridos em volta de cada cidade (verde: alguém no expediente; azul: gêmeo cobrindo),
 * faixas de fuso com a hora local, bonequinhos e arcos tracejados do gêmeo até quem pergunta.
 * Dá para arrastar e dar zoom; cada bonequinho abre o estado atual da pessoa e o link da ficha.
 */

export type MapPerson = {
  id: string;
  name: string;
  title: string;
  city: string;
  time: string;
  status: string;
  /** Quem está com o trabalho agora, em uma frase. */
  holder: string;
  tone: "on" | "twin" | "wait";
  mode: SpriteMode;
  hair: "short" | "long" | "curly" | "bun" | "square";
};
export type MapCrew = {
  key: string;
  location: [number, number];
  tone: "on" | "twin" | "wait";
  label: string;
  people: MapPerson[];
};
export type MapZone = { lng: number; label: string };
export type MapArc = { from: string; to: string; tone: "on" | "twin" };

const TOP = 75;
const BOTTOM = -58;
const SPAN = TOP - BOTTOM;
const STEP = 1.7; // graus entre pontos
const RGB = { on: [152, 255, 56], twin: [77, 141, 255], wait: [224, 179, 84] } as const;
/** Raio, em graus, da área colorida em volta de cada cidade. */
const ACTIVE_RADIUS = 10;
const MIN_Z = 1;
const MAX_Z = 6;
/** Resolução máxima do canvas (dpr × zoom), para não estourar memória em zoom alto. */
const MAX_RENDER = 5;

const x = (lng: number) => (lng + 180) / 360;
const y = (lat: number) => (TOP - lat) / SPAN;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type View = { z: number; tx: number; ty: number };
type Selected = { crew: string; person: string | null; pinned: boolean };
const easeOut = (t: number) => 1 - (1 - t) ** 3;

export function WorldMap({ crews, zones, arcs, nowIso }: { crews: MapCrew[]; zones: MapZone[]; arcs: MapArc[]; nowIso: string }) {
  const wrap = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  /**
   * A posição do mapa vive em `viewRef` e é pintada direto no DOM, uma vez por quadro: arrastar e
   * dar zoom não re-renderizam os bonecos. O React só recebe a posição final (`view`), ao parar.
   */
  const viewRef = useRef<View>({ z: 1, tx: 0, ty: 0 });
  const [view, setCommitted] = useState<View>(viewRef.current);
  const frame = useRef<number | null>(null);
  const commitTimer = useRef<number | null>(null);
  const motion = useRef<number | null>(null);
  /** Cartão aberto: de uma pessoa ou da cidade inteira (person null). Fixo quando veio de clique. */
  const [selected, setSelected] = useState<Selected | null>(null);
  /** O que o cartão mostra; continua montado por um instante depois de fechar, para a saída animar. */
  const [shown, setShown] = useState<{ sel: Selected; leaving: boolean } | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [hint, setHint] = useState(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const redraw = useRef<(() => void) | null>(null);
  const hintTimer = useRef<number | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(190);

  // Desenho da terra em pontos; a resolução acompanha o zoom para os pontos ficarem nítidos.
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
      const scale = Math.min(dpr * viewRef.current.z, MAX_RENDER);
      const w = box.offsetWidth;
      const h = (w * SPAN) / 360;
      el.width = Math.round(w * scale);
      el.height = Math.round(h * scale);
      el.style.height = `${h}px`;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const r = Math.max(0.9, w / 900);
      for (let lat = TOP - STEP / 2; lat > BOTTOM; lat -= STEP) {
        for (let lng = -180 + STEP / 2; lng < 180; lng += STEP) {
          if (!land(lat, lng)) continue;
          // Hora solar local: noite entre 18h e 6h deixa o ponto mais apagado.
          const solar = (((utcHours + lng / 15) % 24) + 24) % 24;
          const night = solar < 6 || solar >= 18;
          // Terra sem ninguém fica discreta; a noite, bem mais apagada que o dia.
          let rgb: readonly number[] = [150, 150, 150];
          let a = night ? 0.12 : 0.32;
          let rr = r;
          for (const c of crews) {
            const d = Math.hypot(lat - c.location[0], (lng - c.location[1]) * Math.cos((lat * Math.PI) / 180));
            if (d < ACTIVE_RADIUS) {
              // Área ativa: cor do estado, cheia no centro e esmaecendo até a borda.
              const k = d / ACTIVE_RADIUS;
              rgb = RGB[c.tone];
              a = 1 - k * 0.6;
              rr = r * (1.25 - k * 0.25);
              break;
            }
          }
          ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a.toFixed(2)})`;
          ctx.beginPath();
          ctx.arc(x(lng) * w, y(lat) * h, rr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };
    redraw.current = draw;

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
    const ro = new ResizeObserver(() => {
      draw();
      setView((v) => v);
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      redraw.current = null;
    };
    // setView é estável: só lê refs e o tamanho da caixa.
  }, [crews, nowIso]);

  // Redesenha nítido quando o zoom para de mudar.
  useEffect(() => {
    const t = window.setTimeout(() => redraw.current?.(), 140);
    return () => clearTimeout(t);
  }, [view.z]);

  const size = () => {
    const w = wrap.current?.offsetWidth ?? 0;
    return { w, h: (w * SPAN) / 360 };
  };

  /** Mantém o mapa cobrindo a moldura: nada de faixa vazia nas bordas. */
  const fit = (v: View): View => {
    const { w, h } = size();
    const z = clamp(v.z, MIN_Z, MAX_Z);
    return { z, tx: clamp(v.tx, w - w * z, 0), ty: clamp(v.ty, h - h * z, 0) };
  };

  /** Pinta a posição atual no palco e reposiciona o cartão aberto, sem passar pelo React. */
  const paint = () => {
    frame.current = null;
    const v = viewRef.current;
    const el = stage.current;
    if (el) {
      el.style.transform = `translate3d(${v.tx}px, ${v.ty}px, 0) scale(${v.z})`;
      el.style.setProperty("--z", String(v.z));
    }
    placeCard.current();
  };

  const setView = useCallback((next: View | ((v: View) => View)) => {
    viewRef.current = fit(typeof next === "function" ? next(viewRef.current) : next);
    wrap.current?.classList.add("is-moving");
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
    // Avisa o React só quando o movimento para (botões, nitidez do canvas, classe de zoom).
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      wrap.current?.classList.remove("is-moving");
      setCommitted({ ...viewRef.current });
    }, 120);
  }, []);

  const stopMotion = () => {
    if (motion.current !== null) cancelAnimationFrame(motion.current);
    motion.current = null;
  };

  /** Zoom em torno de um ponto da moldura (cx, cy em px); animado nos botões e no duplo clique. */
  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number, animate = false) => {
      const { w, h } = size();
      const px = cx ?? w / 2;
      const py = cy ?? h / 2;
      const from = viewRef.current;
      const to = clamp(from.z * factor, MIN_Z, MAX_Z);
      const at = (z: number): View => {
        const k = z / from.z;
        return { z, tx: px - (px - from.tx) * k, ty: py - (py - from.ty) * k };
      };
      stopMotion();
      if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setView(at(to));
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / 280);
        setView(at(from.z + (to - from.z) * easeOut(t)));
        motion.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      motion.current = requestAnimationFrame(step);
    },
    [setView],
  );

  /** Volta ao mundo inteiro, animado. */
  const resetView = () => {
    stopMotion();
    const from = viewRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const t = easeOut(Math.min(1, (now - start) / 320));
      setView({ z: from.z + (1 - from.z) * t, tx: from.tx * (1 - t), ty: from.ty * (1 - t) });
      motion.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    motion.current = requestAnimationFrame(step);
  };

  useLayoutEffect(() => {
    paint();
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (commitTimer.current) clearTimeout(commitTimer.current);
      stopMotion();
    };
  }, []);

  // Roda do mouse: zoom só com Ctrl/⌘, para não prender a rolagem da página.
  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        setHint(true);
        if (hintTimer.current) clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setHint(false), 1400);
        return;
      }
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      box.removeEventListener("wheel", onWheel);
      if (hintTimer.current) clearTimeout(hintTimer.current);
    };
  }, [zoomAt]);

  // Arrastar com um dedo/mouse, pinça com dois; ao soltar, o mapa desliza um pouco (inércia).
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: number; pinch?: number } | null>(null);
  const velocity = useRef({ vx: 0, vy: 0, t: 0 });

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest(".wmap__card, .wmap__controls")) return;
    stopMotion();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = { moved: gesture.current?.moved ?? 0 };
    if (pointers.current.size === 1) gesture.current.moved = 0;
    velocity.current = { vx: 0, vy: 0, t: performance.now() };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !gesture.current) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);
    const pts = [...pointers.current.values()];
    if (pts.length >= 2) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      const r = e.currentTarget.getBoundingClientRect();
      if (gesture.current.pinch) zoomAt(d / gesture.current.pinch, (pts[0]!.x + pts[1]!.x) / 2 - r.left, (pts[0]!.y + pts[1]!.y) / 2 - r.top);
      gesture.current.pinch = d;
      gesture.current.moved += 10;
      velocity.current = { vx: 0, vy: 0, t: performance.now() };
      return;
    }
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture.current.moved > 4 && !e.currentTarget.hasPointerCapture(e.pointerId)) {
      // Só captura quando vira arrasto, para o clique num bonequinho chegar ao botão.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ponteiro já liberado pelo navegador: segue o arrasto sem captura.
      }
      draggingRef.current = true;
      setDragging(true);
      setSelected((s) => (s?.pinned ? s : null));
    }
    // Velocidade suavizada (px/ms), usada na inércia ao soltar.
    const now = performance.now();
    const dt = Math.max(1, now - velocity.current.t);
    velocity.current = { vx: velocity.current.vx * 0.6 + (dx / dt) * 0.4, vy: velocity.current.vy * 0.6 + (dy / dt) * 0.4, t: now };
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    pointers.current.delete(e.pointerId);
    if (gesture.current) gesture.current.pinch = undefined;
    if (pointers.current.size > 0) return;
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    setDragging(false);
    // O clique chega logo depois do pointerup; zera em seguida para o teclado não ficar bloqueado.
    window.setTimeout(() => {
      if (gesture.current && pointers.current.size === 0) gesture.current.moved = 0;
    }, 0);
    let { vx, vy } = velocity.current;
    const idle = performance.now() - velocity.current.t > 80;
    if (!wasDragging || idle || Math.hypot(vx, vy) < 0.05 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let last = performance.now();
    const glide = (now: number) => {
      const dt = now - last;
      last = now;
      setView((v) => ({ ...v, tx: v.tx + vx * dt, ty: v.ty + vy * dt }));
      const decay = Math.pow(0.92, dt / 16);
      vx *= decay;
      vy *= decay;
      motion.current = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(glide) : null;
    };
    motion.current = requestAnimationFrame(glide);
  };
  /** Clique que veio de um arrasto não abre nem fecha nada. */
  const wasDrag = () => (gesture.current?.moved ?? 0) > 4;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  const at = (key: string) => crews.find((c) => c.key === key);
  const { w, h } = size();
  const sel = shown?.sel ?? null;
  const crew = sel ? at(sel.crew) : undefined;
  const person = sel?.person ? crew?.people.find((p) => p.id === sel.person) : crew?.people.length === 1 ? crew.people[0] : undefined;
  const CARD_W = Math.min(300, w - 24);

  /** O cartão fica ao lado do bonequinho, centrado na altura dele e sempre dentro do mapa. */
  const cardPos = () => {
    if (!crew) return { left: 0, top: 0, toLeft: false };
    const v = viewRef.current;
    const { w: cw, h: ch } = size();
    const cardW = Math.min(300, cw - 24);
    const cx = v.tx + x(crew.location[1]) * cw * v.z;
    const cy = v.ty + y(crew.location[0]) * ch * v.z - 20;
    const toLeft = cx + 28 + cardW > cw - 12;
    return {
      left: clamp(toLeft ? cx - 28 - cardW : cx + 28, 12, cw - cardW - 12),
      top: clamp(cy - cardH / 2, 8, Math.max(8, ch - cardH - 8)),
      toLeft,
    };
  };
  const placeCard = useRef(() => {});
  placeCard.current = () => {
    const el = card.current;
    if (!el || !crew) return;
    const p = cardPos();
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
  };
  const pos = cardPos();

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [shown?.sel]);

  // Abrir mostra na hora; fechar deixa o cartão montado por um instante para a animação de saída.
  useEffect(() => {
    if (selected) {
      setShown({ sel: selected, leaving: false });
      return;
    }
    setShown((s) => (s ? { ...s, leaving: true } : s));
    const t = window.setTimeout(() => setShown((s) => (s?.leaving ? null : s)), 180);
    return () => clearTimeout(t);
  }, [selected]);

  // Hover (só mouse): abre uma prévia; sair dela fecha com um atraso curto para dar tempo de chegar ao cartão.
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const hoverOpen = (e: ReactPointerEvent, crewKey: string, personId: string | null) => {
    if (e.pointerType !== "mouse" || draggingRef.current) return;
    cancelClose();
    setSelected((s) => (s?.pinned ? s : { crew: crewKey, person: personId, pinned: false }));
  };
  const hoverClose = (e: ReactPointerEvent) => {
    if (e.pointerType !== "mouse") return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setSelected((s) => (s?.pinned ? s : null)), 220);
  };
  useEffect(() => cancelClose, []);

  return (
    <figure
      className={`wmap${dragging ? " is-dragging" : ""}${view.z > 1.001 ? " is-zoomed" : ""}`}
      ref={wrap}
      aria-label="Mapa da equipe por fuso. Arraste para mover; use os botões, a pinça ou Ctrl e a roda do mouse para o zoom."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, a, .wmap__card")) return;
        const r = e.currentTarget.getBoundingClientRect();
        zoomAt(1.8, e.clientX - r.left, e.clientY - r.top, true);
      }}
      onClick={(e) => {
        if (!wasDrag() && !(e.target as HTMLElement).closest(".wmap__person, .wmap__dot, .wmap__card")) setSelected(null);
      }}
    >
      <div className="wmap__stage" ref={stage}>
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
          <div
            key={c.key}
            className={`wmap__crew wmap__crew--${c.tone}${x(c.location[1]) > 0.82 ? " is-flipped" : ""}${selected?.crew === c.key ? " is-open" : ""}`}
            style={{ left: `${x(c.location[1]) * 100}%`, top: `${y(c.location[0]) * 100}%` }}
          >
            <span className="wmap__people">
              {c.people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`wmap__person${selected?.person === p.id ? " is-selected" : ""}`}
                  aria-label={`${p.name}: ${p.status}`}
                  aria-expanded={selected?.person === p.id}
                  onPointerEnter={(e) => hoverOpen(e, c.key, p.id)}
                  onPointerLeave={hoverClose}
                  onClick={() => {
                    if (wasDrag()) return;
                    cancelClose();
                    setSelected((s) => (s?.person === p.id && s.pinned ? null : { crew: c.key, person: p.id, pinned: true }));
                  }}
                >
                  <PixelSprite look={{ hair: p.hair }} mode={p.mode} size={22} />
                </button>
              ))}
            </span>
            <button
              type="button"
              className="wmap__dot"
              aria-label={`${c.people.map((p) => p.name).join(", ")}: ver quem está aqui`}
              onPointerEnter={(e) => hoverOpen(e, c.key, null)}
              onPointerLeave={hoverClose}
              onClick={() => {
                if (wasDrag()) return;
                cancelClose();
                setSelected((s) => (s?.crew === c.key && s.person === null && s.pinned ? null : { crew: c.key, person: null, pinned: true }));
              }}
            />
            <span className="wmap__label mono">{c.label}</span>
          </div>
        ))}
      </div>

      {crew && !person && (
        <div
          ref={card}
          className={`wmap__card${pos.toLeft ? " is-left" : ""}${shown?.leaving ? " is-leaving" : ""}`}
          style={{ left: pos.left, top: pos.top, width: CARD_W }}
          role="dialog"
          aria-label={`Quem está em ${crew.people[0]?.city ?? crew.key}`}
          onPointerEnter={cancelClose}
          onPointerLeave={hoverClose}
        >
          <div className="wmap__card-head">
            <div>
              <p className="wmap__card-name">{crew.people[0]?.city}</p>
              <p className="mono muted wmap__card-meta">
                {crew.people.length} pessoas · {crew.people[0]?.time}
              </p>
            </div>
            <button type="button" className="wmap__card-close" aria-label="Fechar" onClick={() => setSelected(null)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <ul className="wmap__card-list" role="list">
            {crew.people.map((p) => (
              <li key={p.id}>
                <PixelSprite look={{ hair: p.hair }} mode={p.mode} size={22} />
                <span className="wmap__card-row">
                  <span className="wmap__card-row-name">{p.name}</span>
                  <span className="mono muted wmap__card-row-status">
                    <span className={`dot dot--${p.tone}`} aria-hidden="true" /> {p.status}
                  </span>
                </span>
                <Link href={`/pessoas/${p.id}`} className="wmap__card-link mono" aria-label={`Ver a ficha de ${p.name}`}>
                  FICHA →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {crew && person && (
        <div
          ref={card}
          className={`wmap__card${pos.toLeft ? " is-left" : ""}${shown?.leaving ? " is-leaving" : ""}`}
          style={{ left: pos.left, top: pos.top, width: CARD_W }}
          role="dialog"
          aria-label={`Estado de ${person.name}`}
          onPointerEnter={cancelClose}
          onPointerLeave={hoverClose}
        >
          <div className="wmap__card-head">
            <PixelSprite look={{ hair: person.hair }} mode={person.mode} size={30} />
            <div>
              <p className="wmap__card-name">{person.name}</p>
              <p className="muted wmap__card-title">{person.title}</p>
              <p className="mono muted wmap__card-meta">
                {person.city} · {person.time}
              </p>
            </div>
            <button type="button" className="wmap__card-close" aria-label="Fechar" onClick={() => setSelected(null)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="status-tag mono wmap__card-status">
            <span className={`dot dot--${person.tone}`} aria-hidden="true" />
            {person.status}
          </p>
          <p className="wmap__card-holder">{person.holder}</p>
          <Link href={`/pessoas/${person.id}`} className="wmap__card-link mono">
            VER FICHA →
          </Link>
        </div>
      )}

      <div className="wmap__controls">
        <button type="button" aria-label="Aproximar" onClick={() => zoomAt(1.5, undefined, undefined, true)} disabled={view.z >= MAX_Z - 0.001}>
          +
        </button>
        <button type="button" aria-label="Afastar" onClick={() => zoomAt(1 / 1.5, undefined, undefined, true)} disabled={view.z <= MIN_Z + 0.001}>
          −
        </button>
        <button type="button" aria-label="Ver o mundo inteiro" onClick={resetView} disabled={view.z <= MIN_Z + 0.001}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg>
        </button>
      </div>

      <p className={`wmap__hint mono${hint ? " is-on" : ""}`} aria-hidden="true">
        Ctrl + rolar para o zoom · arraste para mover
      </p>
    </figure>
  );
}
