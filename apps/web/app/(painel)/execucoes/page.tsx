import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("execucoes");
  return <EmBreve route="execucoes" etapa="16" what="Custo por fluxo, execuções, auditoria e controles de ensaio." />;
}
