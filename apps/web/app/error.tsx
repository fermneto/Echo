"use client";

import { ErrorScreen } from "@/components/ErrorScreen";

/** Erro fora do painel (entrada e landing): a tela fica centrada, sem o menu. */
export default function RootError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page">
      <ErrorScreen {...props} home="/" />
    </main>
  );
}
