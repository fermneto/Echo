"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Look } from "@/lib/demo/looks";
import { MiniView, type MiniTab } from "./MiniView";
import { useMiniFeed } from "./useMiniFeed";

type Pip = { requestWindow(options: { width: number; height: number; preferInitialWindowPlacement?: boolean }): Promise<Window> };

const COMPACT = { width: 240, height: 64 };
const OPEN = { width: 320, height: 400 };

const pipApi = () => (window as unknown as { documentPictureInPicture?: Pip }).documentPictureInPicture;
const noSubscribe = () => () => {};

function resize(w: Window, size: { width: number; height: number }) {
  try {
    w.resizeTo(size.width + w.outerWidth - w.innerWidth, size.height + w.outerHeight - w.innerHeight);
  } catch {
    // Sem permissão para redimensionar, a pessoa ainda pode arrastar a borda.
  }
}

/** A janela nova nasce em branco: leva os estilos e as fontes do painel. */
function copyLook(w: Window) {
  w.document.title = "Mini Echo";
  w.document.documentElement.className = document.documentElement.className;
  w.document.body.className = "mini-body";
  document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style').forEach((node) => {
    const copy = node.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
    if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
    w.document.head.append(copy);
  });
}

/**
 * Liga e desliga o Mini Echo: uma janela do navegador que fica sobre todas as outras (Document Picture-in-Picture,
 * Chrome e Edge no computador). Fechada, é só o bonequinho do agente, com o selo de mensagens novas; o clique expande.
 * Só mostra e não altera nada. Ela depende do painel: fecha com a aba dele e ao sair da conta.
 */
export function MiniEcho({ personId, look }: { personId: string; look: Look }) {
  const supported = useSyncExternalStore(
    noSubscribe,
    () => pipApi() !== undefined,
    () => false,
  );
  const [pip, setPip] = useState<Window | null>(null);
  const [tab, setTab] = useState<MiniTab | null>(null);
  const [blocked, setBlocked] = useState(false);
  const opened = useRef<Window | null>(null);
  const close = useCallback(() => opened.current?.close(), []);
  const feed = useMiniFeed({ personId, active: pip !== null, readingMessages: tab === "mensagens", onSignedOut: close });

  useEffect(() => close, [close]);

  const toggle = async () => {
    if (pip) return pip.close();
    const api = pipApi();
    if (!api) return;
    let w: Window;
    try {
      // Sem isto, o navegador reabre no tamanho em que fechou: um bonequinho numa janela expandida.
      w = await api.requestWindow({ ...COMPACT, preferInitialWindowPlacement: true });
    } catch {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    copyLook(w);
    w.addEventListener(
      "pagehide",
      () => {
        opened.current = null;
        setPip(null);
        setTab(null);
      },
      { once: true },
    );
    opened.current = w;
    setPip(w);
  };

  if (!supported) return null;

  // Quem expande com mensagem nova cai direto nela.
  const expand = () => {
    if (!pip) return;
    setTab(feed.fresh > 0 ? "mensagens" : "tarefas");
    resize(pip, OPEN);
  };
  const collapse = () => {
    if (!pip) return;
    setTab(null);
    resize(pip, COMPACT);
  };

  return (
    <>
      <button type="button" className="link-button mono mini-toggle" aria-pressed={pip !== null} title="Janelinha com suas tarefas e mensagens, sobre as outras janelas" onClick={() => void toggle()}>
        {pip && <span className="dot dot--on" aria-hidden="true" />}
        {blocked ? "MINI ECHO: ABRA NO CHROME OU EDGE" : "MINI ECHO"}
      </button>
      {pip && createPortal(<MiniView look={look} {...feed} tab={tab} onExpand={expand} onCollapse={collapse} onPick={setTab} />, pip.document.body)}
    </>
  );
}
