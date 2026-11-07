// Estilo e delegação da pessoa em Postgres real (DATABASE_URL): o juiz e o prompt leem o que ela gravou.
import { randomUUID } from "node:crypto";
import { asSystem, createDb, createPool, type Database, orgs, people } from "@echo/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgDelegationOf } from "./pg-fix.ts";
import { createPgAgentData } from "./pg-data.ts";
import { readAgentProfile, saveAgentProfile } from "./pg-profile.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("estilo e delegação em Postgres", () => {
  let pool: pg.Pool;
  let db: Database;
  const org = randomUUID();
  const fernando = randomUUID();

  beforeAll(async () => {
    pool = createPool(url!, 2, { defaultScope: "none" });
    db = createDb(pool);
    await asSystem(db, async (tx) => {
      await tx.insert(orgs).values({ id: org, name: "Estilo do agente" });
      await tx.insert(people).values({ id: fernando, orgId: org, name: "Fernando Neto", role: "member", timezone: "America/Fortaleza", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } });
    });
  });
  afterAll(async () => {
    if (db) await asSystem(db, (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await pool?.end();
  });

  it("grava limpo, chega ao prompt e ao juiz; a data da delegação só muda quando o texto muda", async () => {
    const t1 = new Date("2026-11-07T10:00:00Z");
    expect(await saveAgentProfile(db, org, fernando, { style: "  Curto e direto. <b>sem</b> rodeio ", delegation: "Pode unir correções pequenas no meu PR." }, t1)).toBe(true);
    expect(await readAgentProfile(db, org, fernando)).toEqual({ style: "Curto e direto. bsem/b rodeio", delegation: "Pode unir correções pequenas no meu PR.", delegationUpdatedAt: t1 });
    expect((await createPgAgentData(db, org).people())[0]!.agentStyle).toBe("Curto e direto. bsem/b rodeio");
    expect(await pgDelegationOf(db)(org, fernando)).toEqual({ name: "Fernando", text: "Pode unir correções pequenas no meu PR.", updatedAt: t1 });

    await saveAgentProfile(db, org, fernando, { style: "Outro tom.", delegation: "Pode unir correções pequenas no meu PR." }, new Date("2026-11-08T10:00:00Z"));
    expect((await readAgentProfile(db, org, fernando))!.delegationUpdatedAt).toEqual(t1);

    await saveAgentProfile(db, org, fernando, { style: "", delegation: "  " }, new Date("2026-11-09T10:00:00Z"));
    expect(await readAgentProfile(db, org, fernando)).toEqual({ style: null, delegation: null, delegationUpdatedAt: null });
    expect(await saveAgentProfile(db, randomUUID(), fernando, { style: "x", delegation: "" }, t1)).toBe(false);
  });
});
