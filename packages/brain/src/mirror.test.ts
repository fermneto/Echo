// Espelho das notas (etapa 14): regras puras e a sincronização contra o Postgres real.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { asSystem, auditLog, brainNotes, brainNoteVersions, createDb, createPool, type Database, identities, orgs, people, teams } from "@echo/db";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgBrainStore } from "./pg.ts";
import { PRODUCT_NOTE_PATH } from "./product-note.ts";
import { canEditByMirror, gitBlobSha, isIgnoredPath, isValidNotePath, parseNoteFile, planNote, renderNote, syncMirror, type MirrorNote, type MirrorSource } from "./mirror.ts";

describe("regras do espelho", () => {
  it("nomes só em minúsculas sem acento, números, hífen e sublinhado", () => {
    expect(isValidNotePath("agente-fernando/diario/2026-11-07.md")).toBe(true);
    expect(isValidNotePath("processos/como_o_echo_funciona.md")).toBe(true);
    for (const bad of ["Agente/nota.md", "agente/decisão.md", "agente/minha nota.md", "agente/nota.txt", "agente//nota.md"]) expect(isValidNotePath(bad)).toBe(false);
  });

  it("configuração do Obsidian e do Git, arquivos que não são Markdown e o README ficam de fora", () => {
    for (const p of [".obsidian/workspace.json", ".gitignore", "agente/.trash/x.md", "imagem.png", "README.md"]) expect(isIgnoredPath(p)).toBe(true);
    expect(isIgnoredPath("agente-yan/perfil.md")).toBe(false);
  });

  it("o sha do blob é o mesmo que o Git calcula", () => {
    const content = "---\ntipo: equipe\nvisibilidade: team\n---\n\nRevisão até 24 h.\n";
    const git = execFileSync("git", ["hash-object", "--stdin"], { input: content }).toString().trim();
    expect(gitBlobSha(content)).toBe(git);
  });

  it("o cabeçalho é do Echo: editar tipo ou visibilidade no Git não muda a nota", () => {
    const file = renderNote({ kind: "decisao", visibility: "team", content: "Tempo limite de 5 s." });
    expect(file).toBe("---\ntipo: decisao\nvisibilidade: team\n---\n\nTempo limite de 5 s.\n");
    expect(parseNoteFile(file)).toBe("Tempo limite de 5 s.");
    expect(parseNoteFile("---\ntipo: decisao\nvisibilidade: private\n---\n\nTempo limite de 3 s.\r\n")).toBe("Tempo limite de 3 s.");
    expect(parseNoteFile("Sem cabeçalho.\n\n")).toBe("Sem cabeçalho.");
  });

  it("decide quem mudou pelo sha da última sincronização", () => {
    const base: MirrorNote = { id: "n", path: "a/b.md", personId: null, kind: "equipe", visibility: "team", content: "v1", sha: null, mirrorConflictAt: null };
    const synced = gitBlobSha(renderNote(base));
    expect(planNote(base, undefined)).toEqual({ kind: "export" });
    expect(planNote({ ...base, sha: synced }, synced)).toEqual({ kind: "in_sync" });
    expect(planNote(base, synced)).toEqual({ kind: "record_sha", sha: synced });
    expect(planNote({ ...base, sha: synced, content: "v2" }, synced)).toEqual({ kind: "export", previousSha: synced });
    expect(planNote({ ...base, sha: synced }, "humano")).toEqual({ kind: "import", sha: "humano", echoAlsoChanged: false });
    expect(planNote({ ...base, sha: synced, content: "v2" }, "humano")).toEqual({ kind: "import", sha: "humano", echoAlsoChanged: true });
    expect(planNote({ ...base, sha: synced }, undefined)).toEqual({ kind: "removed_in_git" });
    expect(planNote({ ...base, sha: synced, mirrorConflictAt: new Date() }, undefined)).toEqual({ kind: "in_sync" });
  });

  it("edita pelo Git a dona, ou a liderança da equipe; nota sem dona, só a liderança; o RH nunca", () => {
    const owner = { personId: "f", teamId: "t" };
    expect(canEditByMirror({ personId: "f", role: "member", teamId: "t" }, owner)).toBe(true);
    expect(canEditByMirror({ personId: "e", role: "member", teamId: "t" }, owner)).toBe(false);
    expect(canEditByMirror({ personId: "m", role: "leader", teamId: "t" }, owner)).toBe(true);
    expect(canEditByMirror({ personId: "m", role: "leader", teamId: "outra" }, owner)).toBe(false);
    expect(canEditByMirror({ personId: "e", role: "member", teamId: "t" }, { personId: null, teamId: null })).toBe(false);
    expect(canEditByMirror({ personId: "m", role: "leader", teamId: "t" }, { personId: null, teamId: null })).toBe(true);
    expect(canEditByMirror({ personId: "f", role: "hr", teamId: null }, owner)).toBe(false);
  });
});

/** Repositório em memória, como o GitHub responderia. */
class FakeRepo implements MirrorSource {
  readonly blobs = new Map<string, string>();
  readonly files = new Map<string, string>();
  readonly authors = new Map<string, string | null>();
  commit(path: string, content: string, author: string | null) {
    const sha = gitBlobSha(content);
    this.blobs.set(sha, content);
    this.files.set(path, sha);
    this.authors.set(path, author);
  }
  async listFiles() {
    return { files: new Map(this.files), truncated: false };
  }
  async readBlob(_repo: string, sha: string) {
    return this.blobs.get(sha)!;
  }
  async lastAuthorLogin(_repo: string, path: string) {
    return this.authors.get(path) ?? null;
  }
}

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("sincronização do espelho (Postgres real)", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const team = randomUUID();
  const id = { fernando: randomUUID(), eduardo: randomUUID(), marina: randomUUID() };
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  const repo = new FakeRepo();
  const note = async (path: string) => (await db.select().from(brainNotes).where(and(eq(brainNotes.orgId, org), eq(brainNotes.path, path))))[0]!;
  const warnings = async () => (await db.select({ action: auditLog.action, target: auditLog.target }).from(auditLog).where(eq(auditLog.orgId, org))).map((w) => `${w.action} ${w.target.replace(/@.*/, "")}`);
  /** A nota do produto pode ser criada em qualquer empresa por outro teste rodando em paralelo: fica de fora. */
  const sync = async () => {
    const r = await syncMirror(db, org, repo, "org-teste/brains");
    return { ...r, exports: r.exports.filter((e) => e.path !== PRODUCT_NOTE_PATH), warnings: r.warnings.filter((w) => w.path !== PRODUCT_NOTE_PATH) };
  };
  /** Mudança feita pelo Echo, pelo caminho normal (gera versão no histórico). */
  const echoWrites = async (path: string, content: string) => {
    const n = await note(path);
    await createPgBrainStore(db, org).write({ kind: "agent" }, { id: n.id, orgId: org, personId: n.personId!, path, kind: n.kind as "diario", visibility: n.visibility as "person", managedByRule: n.managedByRule, content });
  };
  /** Simula o executor: o que a sincronização manda exportar vira commit do Echo. */
  const applyExports = async (exports: Awaited<ReturnType<typeof syncMirror>>["exports"]) => {
    for (const e of exports) {
      repo.commit(e.path, e.content, "echo-teste[bot]");
      await asSystem(db, (tx) => tx.update(brainNotes).set({ sha: gitBlobSha(e.content) }).where(eq(brainNotes.id, e.noteId)));
    }
  };

  beforeAll(async () => {
    pool = createPool(url!, 2);
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values({ id: org, name: "Espelho" });
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto" });
      for (const [name, pid] of Object.entries(id)) await tx.insert(people).values({ id: pid, orgId: org, teamId: team, name, role: name === "marina" ? "leader" : "member", timezone: "America/Fortaleza", workHours: hours });
      await tx.insert(identities).values([
        { orgId: org, personId: id.fernando, platform: "github", externalId: "login:fernando-teste", login: "Fernando-Teste" },
        { orgId: org, personId: id.eduardo, platform: "github", externalId: "login:eduardo-teste", login: "eduardo-teste" },
      ]);
      await tx.insert(brainNotes).values([
        { orgId: org, personId: id.fernando, path: "agente-fernando/decisoes/tempo-limite.md", kind: "decisao", visibility: "team", content: "Tempo limite de 5 s." },
        { orgId: org, personId: id.fernando, path: "agente-fernando/diario/2026-11-06.md", kind: "diario", visibility: "person", content: "Testes do tempo limite." },
        { orgId: org, personId: id.fernando, path: "agente-fernando/ajudas/carla.md", kind: "ajuda", visibility: "private", content: "Privada." },
      ]);
    });
  });

  afterAll(async () => {
    await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await pool.end();
  });

  it("primeira rodada exporta as notas, menos as privadas; a segunda não faz nada", async () => {
    const r = await sync();
    expect(r.exports.map((e) => e.path).sort()).toEqual(["agente-fernando/decisoes/tempo-limite.md", "agente-fernando/diario/2026-11-06.md"]);
    expect(r.exports.every((e) => e.previousSha === undefined)).toBe(true);
    await applyExports(r.exports);
    const again = await sync();
    expect(again).toMatchObject({ imported: 0, exports: [], warnings: [] });
  });

  it("edição no Obsidian pela dona vira versão nova, com ela como autora", async () => {
    const path = "agente-fernando/decisoes/tempo-limite.md";
    repo.commit(path, "---\ntipo: decisao\nvisibilidade: private\n---\n\nTempo limite de 3 s, combinado com a Marina.\n", "fernando-teste");
    const r = await sync();
    expect(r).toMatchObject({ imported: 1, conflicts: 0, exports: [] });
    const n = await note(path);
    expect(n.content).toBe("Tempo limite de 3 s, combinado com a Marina.");
    expect(n.visibility).toBe("team"); // o cabeçalho do Git não muda a visibilidade
    expect(n.mirrorConflictAt).toBeNull();
    const [v] = await db.select().from(brainNoteVersions).where(and(eq(brainNoteVersions.noteId, n.id), eq(brainNoteVersions.version, n.version)));
    expect(v).toMatchObject({ authorKind: "mirror", authorId: id.fernando });
    // O cabeçalho volta ao do Echo na rodada seguinte, sem mexer no conteúdo.
    const fix = await sync();
    expect(fix.exports.map((e) => e.path)).toEqual([path]);
    expect(fix.exports[0]!.content).toContain("visibilidade: team");
    await applyExports(fix.exports);
  });

  it("mudança no Echo vira exportação com o sha esperado", async () => {
    const path = "agente-fernando/diario/2026-11-06.md";
    const before = repo.files.get(path);
    await echoWrites(path, "Testes do tempo limite passando.");
    const r = await sync();
    expect(r.exports).toEqual([expect.objectContaining({ path, previousSha: before })]);
    await applyExports(r.exports);
  });

  it("conflito: os dois mudaram; a edição humana vence, a do Echo fica no histórico e a nota é marcada", async () => {
    const path = "agente-fernando/diario/2026-11-06.md";
    await echoWrites(path, "Versão do Echo.");
    repo.commit(path, "Versão do Fernando, no Obsidian.\n", "fernando-teste");
    const r = await sync();
    expect(r).toMatchObject({ imported: 1, conflicts: 1 });
    const n = await note(path);
    expect(n.content).toBe("Versão do Fernando, no Obsidian.");
    const history = await db.select({ content: brainNoteVersions.content }).from(brainNoteVersions).where(eq(brainNoteVersions.noteId, n.id));
    expect(history.map((h) => h.content)).toContain("Versão do Echo.");
    expect(n.mirrorConflictAt).not.toBeNull();
    expect(await warnings()).toContain(`mirror:conflito brains:${path}`);
  });

  it("conta não ligada e pessoa sem permissão: a edição é recusada com aviso, e a nota não muda", async () => {
    const path = "agente-fernando/decisoes/tempo-limite.md";
    const before = (await note(path)).content;
    repo.commit(path, "Editado por alguém de fora.\n", "desconhecido");
    await sync();
    repo.commit(path, "Editado pelo Eduardo.\n", "eduardo-teste");
    await sync();
    expect((await note(path)).content).toBe(before);
    const w = await warnings();
    expect(w).toContain(`mirror:conta_nao_ligada brains:${path}`);
    expect(w).toContain(`mirror:sem_permissao brains:${path}`);
  });

  it("arquivo desconhecido e nome fora da regra viram aviso, uma vez só, sem criar nota", async () => {
    repo.commit("agente-fernando/ideias.md", "Ideia nova.\n", "fernando-teste");
    repo.commit("Agente Fernando/Decisão.md", "Nome errado.\n", "fernando-teste");
    repo.commit(".obsidian/app.json", "{}", "fernando-teste");
    await sync();
    await sync();
    const w = await warnings();
    expect(w.filter((x) => x === "mirror:desconhecido brains:agente-fernando/ideias.md")).toHaveLength(1);
    expect(w).toContain("mirror:nome_invalido brains:Agente Fernando/Decisão.md");
    expect(w.some((x) => x.includes(".obsidian"))).toBe(false);
    expect((await db.select().from(brainNotes).where(eq(brainNotes.orgId, org))).filter((n) => n.path !== PRODUCT_NOTE_PATH).length).toBe(3);
  });

  it("arquivo apagado no Git não apaga a nota: ela é marcada e não é recriada sozinha", async () => {
    const path = "agente-fernando/decisoes/tempo-limite.md";
    // Parte de um estado sincronizado e depois apaga o arquivo.
    await asSystem(db, (tx) => tx.update(brainNotes).set({ sha: repo.files.get(path)!, mirrorConflictAt: null }).where(and(eq(brainNotes.orgId, org), eq(brainNotes.path, path))));
    repo.files.delete(path);
    const r = await sync();
    expect(r.exports.map((e) => e.path)).not.toContain(path);
    expect((await note(path)).mirrorConflictAt).not.toBeNull();
    expect(await warnings()).toContain(`mirror:removido brains:${path}`);
    expect((await sync()).exports.map((e) => e.path)).not.toContain(path);
  });
});
