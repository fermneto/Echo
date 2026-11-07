// Espelho das notas (etapa 14): o que pode ir para o repositório brains. Regra pura.
//
// O repositório é um só para a empresa, e quem tem acesso a ele lê tudo. Por isso só vai o que toda a empresa
// (fora o RH) já lê pelo `canSee` de packages/brain: notas de equipe sem dona e, quando a empresa inteira é uma
// equipe só, as notas de equipe das pessoas. Nota pessoal (`person`) e privada nunca vão.

/**
 * Se a nota pode ir para o repositório.
 * `oneTeam`: a equipe de todas as pessoas da empresa fora o RH, se for uma só (ver `soleTeam`).
 */
export function isMirrorExportable(n: { visibility: string; personId: string | null; ownerTeamId?: string | null }, oneTeam: string | null): boolean {
  if (n.visibility !== "team") return false;
  if (n.personId === null) return true;
  return oneTeam !== null && n.ownerTeamId === oneTeam;
}

/** A equipe única da empresa (pessoas ativas fora o RH), ou null se houver mais de uma ou alguém sem equipe. */
export function soleTeam(staff: readonly { role: string; teamId: string | null; active: boolean }[]): string | null {
  const ids = new Set(staff.filter((p) => p.active && p.role !== "hr").map((p) => p.teamId));
  if (ids.size !== 1) return null;
  const [only] = ids;
  return only ?? null;
}
