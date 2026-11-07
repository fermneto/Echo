import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("notas");
  return <EmBreve route="notas" etapa="5" what="Cérebros, histórico de versões, avisos do espelho e contradições." />;
}
