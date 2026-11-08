import { notFound, redirect } from "next/navigation";

/**
 * Endereço antigo do aviso da redistribuição (`/redistribuicao/<plano>`), enviado antes do #72: leva ao cartão do
 * plano na página da redistribuição. A permissão continua sendo conferida lá.
 */
export default async function PlanoAntigo({ params }: { params: Promise<{ plano: string }> }) {
  const { plano } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(plano)) notFound();
  redirect(`/redistribuicao#plano-${plano}`);
}
