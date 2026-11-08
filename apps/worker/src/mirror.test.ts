// Espelho das notas de ponta a ponta: sincronização → outbox → executor → sha gravado, com um GitHub em memória.
import { drainActions } from "@echo/actions";
import { createProductNote, gitBlobSha } from "@echo/brain/pg";
import { FileChangedError, type Platforms } from "@echo/connectors";
import { asSystem, brainNotes, createDb, createPool, installationRoutes, orgs, outboxActions } from "@echo/db";
import { InMemoryQueue, QUEUES } from "@echo/jobs";
import { LogRunRecorder } from "@echo/observability";
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mirrorOrg } from "./mirror.ts";

const url = process.env.DATABASE_URL;

/** Repositório brains em memória, com a mesma interface do GithubCodeHost. */
class MemoryBrains {
  readonly files = new Map<string, string>();
  readonly blobs = new Map<string, string>();
  async listFiles() {
    return { files: new Map(this.files), truncated: false };
  }
  async readBlob(_r: string, sha: string) {
    return this.blobs.get(sha)!;
  }
  async editsSince() {
    return { kind: "ok" as const, logins: [] };
  }
  async putFile(_r: string, path: string, content: string, _m: string, previousSha?: string) {
    if (this.files.get(path) !== previousSha) throw new FileChangedError(path);
    const sha = gitBlobSha(content);
    this.blobs.set(sha, content);
    this.files.set(path, sha);
    return { sha };
  }
  async deleteFile(_r: string, path: string, sha: string) {
    if (this.files.get(path) !== sha) throw new FileChangedError(path);
    this.files.delete(path);
  }
}

describe.skipIf(!url)("espelho no worker", () => {
  const pool = createPool(url!, 3);
  const db = createDb(pool);
  const brains = new MemoryBrains();
  const platforms = { github: { forInstallation: () => brains } } as unknown as Platforms;
  const runs = new LogRunRecorder();
  const queue = new InMemoryQueue();
  const drains: string[] = [];
  const deps = { db, platforms, runs, log: pino({ level: "silent" }), brainsRepository: "org-teste/brains", queue };
  let orgId = "";

  beforeAll(async () => {
    await queue.work<{ orgId: string }>(QUEUES.actionsDrain, async (j) => void drains.push(j.data.orgId));
    orgId = await asSystem(db, async (tx) => {
      const [o] = await tx.insert(orgs).values({ name: `Espelho worker ${Math.random().toString(36).slice(2, 7)}` }).returning();
      await tx.insert(installationRoutes).values({ kind: "github", externalId: `espelho-${o!.id}`, orgId: o!.id });
      await tx.insert(brainNotes).values({ orgId: o!.id, path: "equipe/acordos.md", kind: "equipe", visibility: "team", content: "Revisão até 24 h." });
      return o!.id;
    });
    // A nota do produto entra já: outro teste em paralelo poderia criá-la no meio deste.
    await createProductNote(db, orgId);
  });
  afterAll(async () => {
    await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, orgId)));
    await pool.end();
  });

  it("exporta pelo outbox, sem aprovação, e a rodada seguinte não repete nada", async () => {
    expect(await mirrorOrg(deps, orgId)).toEqual({ imported: 0, exported: 2, removed: 0, warnings: 0 });
    expect(drains).toEqual([orgId]); // pede a execução na hora
    const actions = await db.select().from(outboxActions).where(and(eq(outboxActions.orgId, orgId), eq(outboxActions.type, "github.mirror_write")));
    expect(actions.map((a) => a.state)).toEqual(["approved", "approved"]);

    expect(await drainActions({ db, writers: async () => ({ code: brains as never }) }, orgId)).toMatchObject({ done: 2, failed: 0 });
    const [note] = await db.select().from(brainNotes).where(and(eq(brainNotes.orgId, orgId), eq(brainNotes.path, "equipe/acordos.md")));
    expect(note!.sha).toBe(brains.files.get("equipe/acordos.md"));
    expect(brains.blobs.get(note!.sha!)).toContain("Revisão até 24 h.");

    expect(await mirrorOrg(deps, orgId)).toEqual({ imported: 0, exported: 0, removed: 0, warnings: 0 });
    // A segunda rodada não mudou nada: não vira linha em agent_runs.
    expect(runs.runs.filter((r) => r.flow === "brain_mirror").map((r) => r.result)).toEqual(["ok"]);
  });

  it("sem BRAINS_REPOSITORY ou sem GitHub ligado, não faz nada", async () => {
    expect(await mirrorOrg({ ...deps, brainsRepository: undefined }, orgId)).toBeNull();
    expect(await mirrorOrg({ ...deps, platforms: {} }, orgId)).toBeNull();
  });
});
