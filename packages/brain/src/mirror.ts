// Espelho das notas num repositório Git (etapa 14), compatível com o Obsidian.
//
// Banco → Git: nota mudou no Echo e o arquivo não mudou → exportar (pelo outbox, em packages/actions).
// Git → banco: arquivo mudou no Git → importar como versão nova, com a pessoa que fez o commit.
// A edição humana vence. Se o Echo também tinha mudado a nota, a versão do Echo fica no histórico,
// a nota ganha mirror_conflict_at e um aviso: nada é sobrescrito em silêncio.
//
// `brain_notes.sha` guarda o blob do arquivo na última sincronização. É ele que diz quem mudou.
//
// Privacidade: o repositório é um só para a empresa, e quem tem acesso a ele lê tudo. Por isso só vai para o Git
// o que toda a empresa (fora o RH) já pode ler pelo `canSee`: notas de equipe sem dona e, quando a empresa
// inteira é uma equipe só, as notas de equipe das pessoas. Nota pessoal (`person`) e privada nunca vão.
// Se uma nota deixa de ser exportável, o arquivo sai do repositório. O RH não deve ter acesso ao repositório.
import { createHash } from "node:crypto";
import { auditLog, brainNotes, identities, people, withOrg, type Database } from "@echo/db";
import { isMirrorExportable, soleTeam } from "@echo/domain";
import { and, eq, or, sql } from "drizzle-orm";
import type { NoteKind, Visibility } from "./index.ts";
import { createPgBrainStore } from "./pg.ts";

/** Leitura do repositório (implementada pelo GitHub em packages/connectors). */
export interface MirrorSource {
  listFiles(repo: string): Promise<{ files: Map<string, string>; truncated: boolean }>;
  readBlob(repo: string, sha: string): Promise<string>;
  /** Quem fez cada commit no caminho desde `syncedSha`, só com commits verificados (ver packages/connectors). */
  editsSince(repo: string, path: string, syncedSha: string | null): Promise<PathEdits>;
}

export type PathEdits = { kind: "ok"; logins: string[] } | { kind: "nao_verificado" } | { kind: "historico_longo" };

export interface MirrorNote {
  id: string;
  path: string;
  personId: string | null;
  kind: string;
  visibility: string;
  content: string;
  sha: string | null;
  mirrorConflictAt: Date | null;
}

export interface MirrorExport {
  noteId: string;
  path: string;
  content: string;
  /** Blob que se espera encontrar no Git; ausente = arquivo novo. */
  previousSha?: string;
  /** Blob do conteúdo exportado: entra na chave única da ação. */
  sha: string;
}

/** Arquivo que precisa sair do repositório: nota que deixou de ser exportável. */
export interface MirrorRemoval {
  noteId: string;
  path: string;
  /** Blob que está no Git agora: se mudar até a remoção, ela é recusada e refeita na próxima rodada. */
  sha: string;
}

export type MirrorWarningCode = "nome_invalido" | "desconhecido" | "conta_nao_ligada" | "sem_permissao" | "conflito" | "removido" | "nota_fora_da_regra" | "nao_verificado" | "historico_longo";

export interface MirrorWarning {
  code: MirrorWarningCode;
  path: string;
  /** Blob do arquivo (o mesmo aviso não se repete para o mesmo conteúdo). */
  sha?: string;
}

// ------------------------------------------------------------------ regras puras

/** Pastas e arquivos que não são notas: configuração do Obsidian, do Git e o README do repositório. */
export function isIgnoredPath(path: string): boolean {
  return path.split("/").some((s) => s.startsWith(".")) || !path.endsWith(".md") || path === "README.md";
}

/** Nomes só com minúsculas sem acento, números, hífen e sublinhado, em pastas com a mesma regra. */
export function isValidNotePath(path: string): boolean {
  if (!path.endsWith(".md")) return false;
  const parts = path.slice(0, -3).split("/");
  return parts.length > 0 && parts.every((p) => /^[a-z0-9_-]+$/.test(p));
}

/** Sha do blob como o Git calcula: compara o arquivo sem baixar o conteúdo. */
export function gitBlobSha(content: string): string {
  const buf = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
}

/** Arquivo do espelho: tipo e visibilidade no cabeçalho (o Obsidian mostra como propriedades). */
export function renderNote(note: Pick<MirrorNote, "kind" | "visibility" | "content">): string {
  const body = note.content.endsWith("\n") ? note.content : `${note.content}\n`;
  return `---\ntipo: ${note.kind}\nvisibilidade: ${note.visibility}\n---\n\n${body}`;
}

/** Conteúdo de um arquivo editado. O cabeçalho é do Echo: mudar tipo ou visibilidade no Git não vale. */
export function parseNoteFile(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const m = /^---\n[\s\S]*?\n---\n\n?/.exec(normalized);
  const body = m ? normalized.slice(m[0].length) : normalized;
  return body.replace(/\n+$/, "");
}

/** O que pode ir para o repositório: regra pura em packages/domain, a mesma que o executor confere antes de escrever. */
export const isExported = isMirrorExportable;
export { soleTeam };

export type NoteAction =
  | { kind: "in_sync" }
  | { kind: "record_sha"; sha: string }
  | { kind: "export"; previousSha?: string }
  | { kind: "import"; sha: string; echoAlsoChanged: boolean }
  | { kind: "removed_in_git" };

/** Decide, para uma nota exportável, o que fazer comparando o banco com o arquivo no Git. */
export function planNote(note: MirrorNote, fileSha: string | undefined): NoteAction {
  const rendered = gitBlobSha(renderNote(note));
  if (fileSha === undefined) {
    if (note.sha === null) return { kind: "export" };
    return note.mirrorConflictAt ? { kind: "in_sync" } : { kind: "removed_in_git" };
  }
  if (fileSha === rendered) return note.sha === fileSha ? { kind: "in_sync" } : { kind: "record_sha", sha: fileSha };
  if (note.sha === fileSha) return { kind: "export", previousSha: fileSha };
  // O arquivo mudou no Git. Se a nota também mudou no Echo (ou nunca foi sincronizada), é conflito.
  return { kind: "import", sha: fileSha, echoAlsoChanged: note.sha === null || rendered !== note.sha };
}

/** Quem pode editar a nota pelo Git: a dona, ou a liderança da equipe dela. Nota sem dona: a liderança. O RH nunca. */
export function canEditByMirror(editor: { personId: string; role: string; teamId: string | null }, owner: { personId: string | null; teamId: string | null }): boolean {
  if (editor.role === "hr") return false;
  if (owner.personId === null) return editor.role === "leader";
  if (owner.personId === editor.personId) return true;
  return editor.role === "leader" && editor.teamId !== null && editor.teamId === owner.teamId;
}

// ------------------------------------------------------------------ sincronização

export interface MirrorResult {
  imported: number;
  conflicts: number;
  exports: MirrorExport[];
  removals: MirrorRemoval[];
  warnings: MirrorWarning[];
  truncated: boolean;
}

/**
 * Compara as notas da empresa com o repositório, importa as edições humanas e devolve o que exportar.
 * Não escreve no Git: as exportações vão para o outbox (packages/actions), por quem chamou.
 */
export async function syncMirror(db: Database, orgId: string, source: MirrorSource, repo: string): Promise<MirrorResult> {
  const { files, truncated } = await source.listFiles(repo);
  const out: MirrorResult = { imported: 0, conflicts: 0, exports: [], removals: [], warnings: [], truncated };
  const staff = await withOrg(db, orgId, (tx) => tx.select({ role: people.role, teamId: people.teamId, active: people.active }).from(people).where(eq(people.orgId, orgId)));
  const oneTeam = soleTeam(staff);
  const exported = (n: (typeof notes)[number]) => isExported(n, oneTeam);

  const notes = await withOrg(db, orgId, (tx) =>
    tx
      .select({
        id: brainNotes.id,
        path: brainNotes.path,
        personId: brainNotes.personId,
        kind: brainNotes.kind,
        visibility: brainNotes.visibility,
        content: brainNotes.content,
        sha: brainNotes.sha,
        mirrorConflictAt: brainNotes.mirrorConflictAt,
        ownerTeamId: people.teamId,
      })
      .from(brainNotes)
      .leftJoin(people, and(eq(people.orgId, brainNotes.orgId), eq(people.id, brainNotes.personId)))
      .where(eq(brainNotes.orgId, orgId)),
  );
  const byPath = new Map(notes.map((n) => [n.path, n]));

  // Arquivos no Git sem nota correspondente; os de nota que não pode estar lá saem do repositório.
  for (const [path, sha] of files) {
    if (isIgnoredPath(path)) continue;
    const n = byPath.get(path);
    if (n && exported(n)) continue;
    if (n) out.removals.push({ noteId: n.id, path, sha });
    else out.warnings.push({ code: isValidNotePath(path) ? "desconhecido" : "nome_invalido", path, sha });
  }

  for (const note of notes) {
    if (!exported(note)) {
      // Já saiu do Git: esquece o ponto de sincronização, para voltar como arquivo novo se um dia puder.
      // Com a lista cortada, "não está na lista" não quer dizer que saiu do Git: o sha só é esquecido com a lista inteira.
      if (note.sha !== null && !truncated && !files.has(note.path)) await withOrg(db, orgId, (tx) => tx.update(brainNotes).set({ sha: null }).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, note.id))));
      continue;
    }
    if (!isValidNotePath(note.path)) {
      out.warnings.push({ code: "nota_fora_da_regra", path: note.path });
      continue;
    }
    // Lista cortada: um arquivo fora dela pode existir; nada de exportar por cima nem marcar como apagado.
    if (truncated && !files.has(note.path)) continue;
    const action = planNote(note, files.get(note.path));
    switch (action.kind) {
      case "in_sync":
        break;
      case "record_sha":
        await withOrg(db, orgId, (tx) => tx.update(brainNotes).set({ sha: action.sha }).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, note.id))));
        break;
      case "export": {
        const content = renderNote(note);
        out.exports.push({ noteId: note.id, path: note.path, content, sha: gitBlobSha(content), ...(action.previousSha ? { previousSha: action.previousSha } : {}) });
        break;
      }
      case "removed_in_git":
        // Apagar no Git não apaga a nota: fica marcada para alguém decidir, e não é recriada sozinha.
        await withOrg(db, orgId, (tx) => tx.update(brainNotes).set({ mirrorConflictAt: new Date() }).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, note.id))));
        out.warnings.push({ code: "removido", path: note.path });
        break;
      case "import": {
        // Todos os commits desde a última sincronização, não só o último: cada um precisa de quem pode editar.
        const edits = await source.editsSince(repo, note.path, note.sha);
        if (edits.kind !== "ok") {
          out.warnings.push({ code: edits.kind, path: note.path, sha: action.sha });
          break;
        }
        // Sem repetição e na mesma ordem: o primeiro é quem fez o commit mais recente.
        const editors = await Promise.all([...new Set(edits.logins)].map((l) => editorByLogin(db, orgId, l)));
        if (edits.logins.length === 0 || editors.some((e) => !e)) {
          out.warnings.push({ code: "conta_nao_ligada", path: note.path, sha: action.sha });
          break;
        }
        if (!editors.every((e) => canEditByMirror(e!, { personId: note.personId, teamId: note.ownerTeamId }))) {
          out.warnings.push({ code: "sem_permissao", path: note.path, sha: action.sha });
          break;
        }
        const editor = editors[0]!;
        const content = parseNoteFile(await source.readBlob(repo, action.sha));
        await importEdit(db, orgId, note.id, editor.personId, content, action.sha, action.echoAlsoChanged);
        out.imported++;
        if (action.echoAlsoChanged) {
          out.conflicts++;
          out.warnings.push({ code: "conflito", path: note.path, sha: action.sha });
        }
        break;
      }
    }
  }

  await recordWarnings(db, orgId, out.warnings);
  return out;
}

async function editorByLogin(db: Database, orgId: string, login: string) {
  const [row] = await withOrg(db, orgId, (tx) =>
    tx
      .select({ personId: people.id, role: people.role, teamId: people.teamId })
      .from(identities)
      .innerJoin(people, and(eq(people.orgId, identities.orgId), eq(people.id, identities.personId)))
            // O login do GitHub, sem diferença de maiúsculas (como em resolvePeople, no ingest); `login:<x>` é o formato antigo.
      .where(
        and(
          eq(identities.orgId, orgId),
          eq(identities.platform, "github"),
          or(eq(sql`lower(${identities.login})`, login.toLowerCase()), eq(identities.externalId, `login:${login.toLowerCase()}`)),
          eq(people.active, true),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

/** Versão nova com a edição do Git, e o sha do arquivo como ponto de sincronização. */
async function importEdit(db: Database, orgId: string, noteId: string, personId: string, content: string, sha: string, conflict: boolean): Promise<void> {
  const store = createPgBrainStore(db, orgId);
  const [current] = await withOrg(db, orgId, (tx) => tx.select().from(brainNotes).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, noteId))));
  if (!current) return;
  if (current.content !== content) {
    await store.write(
      { kind: "mirror", id: personId },
      {
        id: noteId,
        orgId,
        ...(current.personId ? { personId: current.personId } : {}),
        path: current.path,
        kind: current.kind as NoteKind,
        content,
        visibility: current.visibility as Visibility,
        managedByRule: current.managedByRule,
      },
    );
  }
  await withOrg(db, orgId, (tx) =>
    tx
      .update(brainNotes)
      .set({ sha, ...(conflict ? { mirrorConflictAt: new Date() } : {}) })
      .where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.id, noteId))),
  );
}

/** Avisos do espelho na auditoria (o painel mostra em Notas). O mesmo aviso, para o mesmo conteúdo, entra uma vez. */
async function recordWarnings(db: Database, orgId: string, warnings: MirrorWarning[]): Promise<void> {
  if (!warnings.length) return;
  await withOrg(db, orgId, async (tx) => {
    for (const w of warnings) {
      const target = `brains:${w.path}${w.sha ? `@${w.sha.slice(0, 12)}` : ""}`;
      const action = `mirror:${w.code}`;
      const [seen] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, action), eq(auditLog.target, target))).limit(1);
      if (!seen) await tx.insert(auditLog).values({ orgId, actor: "echo:espelho", action, target });
    }
  });
}
