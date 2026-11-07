import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("relatorios");
  return <EmBreve route="relatorios" etapa="12" what="Relatório semanal, observação e registro de ajuda." />;
}
