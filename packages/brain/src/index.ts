// Porta do cérebro. Todo acesso às notas passa por aqui; a permissão é checada ANTES do modelo.
export type Visibility = "private" | "person" | "team";
export type NoteKind = "perfil" | "diario" | "tarefa" | "alteracao" | "decisao" | "nao-mexer" | "ajuda" | "correcao" | "processo" | "equipe";

export interface BrainNote {
  id: string;
  orgId: string;
  personId?: string;
  path: string; // agente-fernando/decisoes/tempo-limite.md
  kind: NoteKind;
  content: string;
  visibility: Visibility;
  version: number;
  managedByRule: boolean;
  updatedAt: Date;
}

export interface Viewer {
  personId: string;
  role: "member" | "leader" | "hr";
  teamId?: string;
}

export interface SearchFilters {
  personId?: string;
  taskKey?: string;
  branch?: string;
  prNumber?: number;
  /** A busca dos agentes ignora notas mantidas por regra. */
  includeRuleManaged?: boolean;
  limit?: number;
}

export interface BrainStore {
  get(viewer: Viewer, id: string): Promise<BrainNote | null>;
  search(viewer: Viewer, query: string, filters?: SearchFilters): Promise<BrainNote[]>;
  /** Cria versão nova. A correção humana vence: agentes não sobrescrevem `correcoes/`. */
  write(author: { kind: "person" | "agent" | "mirror"; id?: string }, note: Omit<BrainNote, "id" | "version" | "updatedAt"> & { id?: string }): Promise<BrainNote>;
  history(viewer: Viewer, id: string): Promise<{ version: number; content: string; authorKind: string; createdAt: Date }[]>;
}

// Regra de visibilidade (pura, sem banco). A implementação em Postgres fica em "@echo/brain/pg",
// para quem só usa os tipos (o painel, por exemplo) não carregar o driver do banco.
export { canSee, isCorrectionPath, type NoteOwner } from "./permissions.ts";
