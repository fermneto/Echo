import { requireAccess } from "@/lib/session";
import { EmBreve } from "@/components/EmBreve";

export default async function Page() {
  await requireAccess("escritorio");
  return <EmBreve route="escritorio" etapa="16" what="Mapa com cada pessoa no seu fuso e móveis que abrem as ferramentas." />;
}
