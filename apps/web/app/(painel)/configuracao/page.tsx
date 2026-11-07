import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("configuracao");
  return <EmBreve route="configuracao" etapa="15" what="Slack, Linear, pessoas, contas, RH e limite de custo." />;
}
