// Quem pode ver cada nota. Checado ANTES de o conteúdo chegar ao modelo (etapa 5).
//
// | visibilidade | quem vê                                                        |
// |--------------|----------------------------------------------------------------|
// | private      | só a dona da nota                                              |
// | person       | a dona e a liderança da equipe dela                            |
// | team         | a equipe da dona (nota sem dona: toda a empresa)               |
//
// O RH nunca lê cérebros, em nenhuma visibilidade.
import type { BrainNote, Viewer } from "./index.ts";

export interface NoteOwner {
  /** Equipe da dona da nota, se ela tiver dona. */
  teamId?: string | null;
}

export function canSee(viewer: Viewer, note: Pick<BrainNote, "personId" | "visibility">, owner: NoteOwner = {}): boolean {
  if (viewer.role === "hr") return false;
  const isOwner = note.personId !== undefined && note.personId === viewer.personId;
  if (isOwner) return true;
  const sameTeam = viewer.teamId !== undefined && owner.teamId != null && owner.teamId === viewer.teamId;
  switch (note.visibility) {
    case "private":
      return false;
    case "person":
      return viewer.role === "leader" && sameTeam;
    case "team":
      return note.personId === undefined || sameTeam;
  }
}

/** Agentes nunca sobrescrevem o que a pessoa corrigiu. */
export function isCorrectionPath(path: string): boolean {
  return /(^|\/)correcoes\//.test(path);
}
