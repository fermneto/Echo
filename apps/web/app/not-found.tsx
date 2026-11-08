import Link from "next/link";
import { StatusScreen } from "@/components/StatusScreen";

export const metadata = { title: "Página não encontrada · Echo" };

/** Endereço que não existe, ou tela que a pessoa não tem permissão de ver. */
export default function NotFound() {
  return (
    <main className="page">
      <StatusScreen title="Esta página não existe." text="O endereço pode estar errado, ou esta tela não está disponível para o seu acesso.">
        <Link href="/" className="button-pill">
          Ir para o início
        </Link>
      </StatusScreen>
    </main>
  );
}
