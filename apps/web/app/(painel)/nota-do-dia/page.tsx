import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("notaDoDia");
  return <EmBreve route="notaDoDia" etapa="8" what="Conferir, editar e confirmar a nota, com o que fica liberado e reservado." />;
}
