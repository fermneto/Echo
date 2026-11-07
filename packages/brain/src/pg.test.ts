// BrainStore contra o Postgres real (DATABASE_URL), depois de `pnpm db:migrate`.
import { randomUUID } from "node:crypto";
import { asSystem, brainNotes, createDb, createPool, type Database, orgs, people, teams } from "@echo/db";
import { and, eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrainStore, Viewer } from "./index.ts";
import { CorrectionProtectedError, createPgBrainStore } from "./pg.ts";
import { ensureProductNote, PRODUCT_NOTE_PATH } from "./product-note.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("BrainStore em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  let store: BrainStore;
  const org = randomUUID();
  const other = randomUUID();
  const team = randomUUID();
  const id = { fernando: randomUUID(), eduardo: randomUUID(), marina: randomUUID(), rita: randomUUID() };
  const viewer = (who: keyof typeof id, role: Viewer["role"] = "member"): Viewer => ({ personId: id[who], role, ...(role === "hr" ? {} : { teamId: team }) });
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
  let decisionId = "";

  beforeAll(async () => {
    pool = createPool(url!, 2);
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values([{ id: org, name: "Cérebro A" }, { id: other, name: "Cérebro B" }]);
      await tx.insert(teams).values({ id: team, orgId: org, name: "Produto" });
      for (const [name, pid] of Object.entries(id)) {
        await tx.insert(people).values({ id: pid, orgId: org, teamId: name === "rita" ? null : team, name, role: name === "marina" ? "leader" : name === "rita" ? "hr" : "member", timezone: "America/Fortaleza", workHours: hours });
      }
    });
    store = createPgBrainStore(db, org);
    const person = { kind: "person" as const, id: id.fernando };
    const decision = await store.write(person, {
      orgId: org, personId: id.fernando, path: "agente-fernando/decisoes/tempo-limite.md", kind: "decisao", visibility: "team", managedByRule: false,
      content: "# Tempo limite nos pagamentos\n\nO tempo limite da confirmação de pagamento é de 5 segundos. Ver PR 44 e a branch ech-128-tempo-limite (ECH-128).",
    });
    decisionId = decision.id;
    await store.write(person, { orgId: org, personId: id.fernando, path: "agente-fernando/diario/2026-11-05.md", kind: "diario", visibility: "person", managedByRule: false, content: "Pagamentos: testes do tempo limite falhando." });
    await store.write(person, { orgId: org, personId: id.fernando, path: "agente-fernando/ajudas/carla.md", kind: "ajuda", visibility: "private", managedByRule: false, content: "Carla ajudou com o tempo limite dos pagamentos." });
    await store.write({ kind: "agent" }, { orgId: org, personId: id.fernando, path: "agente-fernando/tarefas/ech-128.md", kind: "tarefa", visibility: "team", managedByRule: true, content: "ECH-128: tempo limite nos pagamentos, em andamento." });
  });

  afterAll(async () => {
    if (db) await asSystem(db, async (tx) => { await tx.delete(orgs).where(eq(orgs.id, org)); await tx.delete(orgs).where(eq(orgs.id, other)); });
    await pool?.end();
  });

  const paths = (notes: { path: string }[]) => notes.map((n) => n.path).sort();

  it("quem não pode ver uma nota não a recebe na busca", async () => {
    expect(paths(await store.search(viewer("fernando"), "pagamentos"))).toEqual([
      "agente-fernando/ajudas/carla.md", "agente-fernando/decisoes/tempo-limite.md", "agente-fernando/diario/2026-11-05.md",
    ]);
    expect(paths(await store.search(viewer("eduardo"), "pagamentos"))).toEqual(["agente-fernando/decisoes/tempo-limite.md"]);
    expect(paths(await store.search(viewer("marina", "leader"), "pagamentos"))).toEqual(["agente-fernando/decisoes/tempo-limite.md", "agente-fernando/diario/2026-11-05.md"]);
    expect(await store.search(viewer("rita", "hr"), "pagamentos")).toEqual([]);
  });

  it("a busca dos agentes ignora notas mantidas por regra, a não ser que peça", async () => {
    expect(paths(await store.search(viewer("eduardo"), "andamento"))).toEqual([]);
    expect(paths(await store.search(viewer("eduardo"), "andamento", { includeRuleManaged: true }))).toEqual(["agente-fernando/tarefas/ech-128.md"]);
  });

  it("filtra por pessoa, tarefa, branch e PR", async () => {
    const e = viewer("fernando");
    expect(paths(await store.search(e, "", { taskKey: "ECH-128" }))).toEqual(["agente-fernando/decisoes/tempo-limite.md"]);
    expect(paths(await store.search(e, "", { branch: "ech-128-tempo-limite" }))).toEqual(["agente-fernando/decisoes/tempo-limite.md"]);
    expect(paths(await store.search(e, "", { prNumber: 44 }))).toEqual(["agente-fernando/decisoes/tempo-limite.md"]);
    expect(await store.search(e, "", { prNumber: 4 })).toEqual([]);
    expect(await store.search(e, "pagamentos", { personId: id.eduardo })).toEqual([]);
  });

  it("editar uma nota muda o resultado da busca (cena 2)", async () => {
    expect(paths(await store.search(viewer("eduardo"), "8 segundos"))).toEqual([]);
    const current = await store.get(viewer("fernando"), decisionId);
    const edited = await store.write({ kind: "person", id: id.fernando }, { ...current!, content: current!.content.replace("5 segundos", "8 segundos") });
    expect(edited.version).toBe(2);
    const found = await store.search(viewer("eduardo"), "8 segundos");
    expect(found.map((n) => n.id)).toEqual([decisionId]);
    expect(found[0]?.content).toContain("8 segundos");
  });

  it("guarda o histórico de versões, só para quem pode ver", async () => {
    const h = await store.history(viewer("eduardo"), decisionId);
    expect(h.map((v) => [v.version, v.authorKind])).toEqual([[2, "person"], [1, "person"]]);
    expect(h[1]?.content).toContain("5 segundos");
    expect(await store.history(viewer("rita", "hr"), decisionId)).toEqual([]);
  });

  it("get respeita a visibilidade", async () => {
    const [diary] = await store.search(viewer("fernando"), "falhando");
    expect(await store.get(viewer("marina", "leader"), diary!.id)).not.toBeNull();
    expect(await store.get(viewer("eduardo"), diary!.id)).toBeNull();
    expect(await store.get(viewer("eduardo"), "nao-e-uuid")).toBeNull();
  });

  it("agente não sobrescreve correções da pessoa", async () => {
    const correction = { orgId: org, personId: id.fernando, path: "agente-fernando/correcoes/tempo-limite.md", kind: "correcao" as const, visibility: "team" as const, managedByRule: false, content: "Fernando corrigiu: 8 segundos." };
    await store.write({ kind: "person", id: id.fernando }, correction);
    await expect(store.write({ kind: "agent" }, { ...correction, content: "5 segundos" })).rejects.toBeInstanceOf(CorrectionProtectedError);
  });

  it("outra empresa não enxerga as notas", async () => {
    const otherStore = createPgBrainStore(db, other);
    expect(await otherStore.search({ personId: id.fernando, role: "member", teamId: team }, "pagamentos")).toEqual([]);
    expect(await otherStore.get(viewer("fernando"), decisionId)).toBeNull();
    await expect(otherStore.write({ kind: "person" }, { orgId: org, path: "x.md", kind: "equipe", visibility: "team", managedByRule: false, content: "x" })).rejects.toThrow(/outra empresa/);
  });

  it("cria a nota do produto uma vez por empresa", async () => {
    // Outros pacotes criam empresas no mesmo banco em paralelo na CI: a contagem global varia,
    // então a checagem é só sobre esta empresa.
    await ensureProductNote(db);
    await ensureProductNote(db);
    const rows = await asSystem(db, (tx) =>
      tx.select({ version: brainNotes.version }).from(brainNotes).where(and(eq(brainNotes.orgId, org), eq(brainNotes.path, PRODUCT_NOTE_PATH))),
    );
    expect(rows).toEqual([{ version: 1 }]);
    const [note] = await store.search(viewer("eduardo"), "como o echo funciona");
    expect(note?.path).toBe(PRODUCT_NOTE_PATH);
  });
});
