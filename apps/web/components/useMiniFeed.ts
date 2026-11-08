"use client";

import { useEffect, useRef, useState } from "react";
import { parseSeen, unseenCount, type MiniData } from "@/lib/mini";

const POLL_MS = 60_000;

const seenKey = (personId: string) => `echo-mini-vistas:${personId}`;

function readSeen(personId: string): Set<string> {
  try {
    return parseSeen(window.localStorage.getItem(seenKey(personId)));
  } catch {
    return new Set();
  }
}

function writeSeen(personId: string, keys: string[]) {
  try {
    window.localStorage.setItem(seenKey(personId), JSON.stringify(keys));
  } catch {
    // Sem armazenamento, o contador só volta a mostrar as mesmas mensagens.
  }
}

/** Dados do Mini Echo enquanto ele está ligado. Abrir a lista de mensagens conta como ver. */
export function useMiniFeed({ personId, active, readingMessages, onSignedOut }: { personId: string; active: boolean; readingMessages: boolean; onSignedOut: () => void }) {
  const [data, setData] = useState<MiniData | null>(null);
  const [failed, setFailed] = useState(false);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const signedOut = useRef(onSignedOut);

  useEffect(() => {
    signedOut.current = onSignedOut;
  }, [onSignedOut]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setSeen(readSeen(personId));
    const load = async () => {
      try {
        const res = await fetch("/api/mini", { cache: "no-store" });
        if (res.status === 401) return signedOut.current();
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as MiniData;
        if (!alive) return;
        setData(next);
        setFailed(false);
      } catch {
        if (alive) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active, personId]);

  useEffect(() => {
    if (!readingMessages || !data) return;
    const keys = data.messages.map((m) => m.key);
    setSeen(new Set(keys));
    writeSeen(personId, keys);
  }, [readingMessages, data, personId]);

  return { data, failed, fresh: data ? unseenCount(data.messages, seen) : 0 };
}
