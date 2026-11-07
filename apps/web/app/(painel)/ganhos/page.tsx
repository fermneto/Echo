import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("ganhos");
  return <EmBreve route="ganhos" etapa="13" what="Espera evitada e revisões antes e depois, só em totais." />;
}
