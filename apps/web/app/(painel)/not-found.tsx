import Link from "next/link";
import { StatusScreen } from "@/components/StatusScreen";

export const metadata = { title: "Página não encontrada · Echo" };

/** Dentro do painel, a tela de não encontrado mantém o menu. */
export default function NotFoundPainel() {
  return (
    <StatusScreen title="Esta página não existe." text="O endereço pode estar errado, ou esta tela não está disponível para o seu acesso.">
      <Link href="/" className="button-pill">
        Ir para o início
      </Link>
    </StatusScreen>
  );
}
