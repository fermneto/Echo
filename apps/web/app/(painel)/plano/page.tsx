import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("plano");
  return <EmBreve route="plano" etapa="9" what="Plano do dia, correções a aprovar, achados e perguntas pendentes." />;
}
