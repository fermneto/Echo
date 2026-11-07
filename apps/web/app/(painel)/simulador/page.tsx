import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("simulador");
  return <EmBreve route="simulador" etapa="16" what="Conversa pelo mesmo fluxo do Slack, só na demonstração." />;
}
