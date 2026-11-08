import type { TeamScope } from "@/lib/scope";
import { TeamPickerForm } from "./TeamPickerForm";

/** Só o RH: escolhe quais equipes acompanhar. A escolha vale para o mapa, Pessoas e as fichas. */
export function TeamPicker({ scope, back }: { scope: TeamScope; back: string }) {
  if (!scope.canChoose) return null;
  return <TeamPickerForm teams={scope.teams.map((t) => ({ id: t.id, name: t.name }))} visible={scope.visible} back={back} />;
}
