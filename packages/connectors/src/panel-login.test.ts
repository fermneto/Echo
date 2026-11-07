import { createDb, createPool, identities, installationRoutes, orgs, people } from "@echo/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPanelPerson, resolvePanelPerson } from "./panel-login.ts";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("resolvePanelPerson (Postgres real)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  const team = `T-LOGIN-${Math.random().toString(36).slice(2, 7)}`;
  let orgId = "";
  let mar = "";
  beforeAll(async () => {
    const [org] = await db.insert(orgs).values({ name: `Teste login ${team}` }).returning();
    orgId = org!.id;
    const wh = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };
    const [m] = await db.insert(people).values({ orgId, name: "Marina", role: "leader", timezone: "America/Sao_Paulo", workHours: wh }).returning();
    const [x] = await db.insert(people).values({ orgId, name: "Ex-funcionário", timezone: "America/Sao_Paulo", workHours: wh, active: false }).returning();
    mar = m!.id;
    await db.insert(identities).values([
      { orgId, personId: mar, platform: "slack", externalId: "UMAR" },
      { orgId, personId: x!.id, platform: "slack", externalId: "UEX" },
    ]);
    await db.insert(installationRoutes).values({ kind: "slack", externalId: team, orgId });
  });
  afterAll(async () => {
    await db.delete(installationRoutes).where(eq(installationRoutes.orgId, orgId));
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await pool.end();
  });

  it("acha a empresa pelo espaço e a pessoa pela conta do Slack, com o papel", async () => {
    expect(await resolvePanelPerson(db, { userId: "UMAR", teamId: team })).toEqual({ ok: true, person: { orgId, personId: mar, name: "Marina", role: "leader" } });
    expect((await loadPanelPerson(db, orgId, mar))?.name).toBe("Marina");
  });

  it("recusa espaço de outra empresa, pessoa não cadastrada e pessoa desligada", async () => {
    expect(await resolvePanelPerson(db, { userId: "UMAR", teamId: "T-OUTRO" })).toEqual({ ok: false, reason: "espaco_desconhecido" });
    expect(await resolvePanelPerson(db, { userId: "UNOVO", teamId: team })).toEqual({ ok: false, reason: "pessoa_nao_cadastrada" });
    expect(await resolvePanelPerson(db, { userId: "UEX", teamId: team })).toEqual({ ok: false, reason: "pessoa_inativa" });
  });
});
