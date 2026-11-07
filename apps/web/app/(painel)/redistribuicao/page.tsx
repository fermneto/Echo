import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("redistribuicao");
  return <EmBreve route="redistribuicao" etapa="11" what="Registrar ausência, gerar e aprovar planos, nova demanda e itens parados." />;
}
