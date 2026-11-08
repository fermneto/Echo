"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { StatusScreen } from "./StatusScreen";

/** Erro numa tela: tentar de novo busca os dados no servidor outra vez, e o código ajuda a achar a falha no log. */
export function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => console.error(error), [error]);
  return (
    <StatusScreen title="Esta tela não carregou." text="Pode ser uma falha passageira. Tente de novo e, se continuar, avise a liderança da equipe." code={error.digest}>
      <button
        type="button"
        className="button-pill"
        onClick={() =>
          startTransition(() => {
            router.refresh();
            reset();
          })
        }
      >
        Tentar de novo
      </button>
      <Link href="/" className="text-link">
        Ir para o início
      </Link>
    </StatusScreen>
  );
}
