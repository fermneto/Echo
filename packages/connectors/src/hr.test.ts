import { absences, auditLog, createDb, createPool, identities, orgs, people } from "@echo/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TokenCipher } from "./crypto.ts";
import { applyHrEvent, hrSecret, parseHrEvent, rotateHrSecret } from "./hr.ts";

const vac = (over: Record<string, unknown> = {}) => ({ id: "evento-1", employee_id: "123", starts_at: "2026-11-10T00:00:00-03:00", ends_at: "2026-11-21T23:59:59-03:00", kind: "vacation", ...over });

describe("parseHrEvent", () => {
  it("lê férias e cancelamento, descartando o motivo", () => {
    const ev = parseHrEvent(vac({ reason: "CID J11", motivo: "atestado" }));
    expect(ev).toEqual({ id: "evento-1", employeeId: "123", startsAt: new Date("2026-11-10T03:00:00Z"), endsAt: new Date("2026-11-22T02:59:59Z"), kind: "vacation" });
    expect(JSON.stringify(ev)).not.toMatch(/CID|atestado/);
    expect(parseHrEvent({ id: "evento-1", action: "cancel" })).toEqual({ id: "evento-1", action: "cancel" });
  });

  it("recusa aviso inválido: sem fuso, fim antes do início, tipo desconhecido, campos faltando", () => {
    expect(parseHrEvent(vac({ starts_at: "2026-11-10T00:00:00" }))).toBeNull();
    expect(parseHrEvent(vac({ ends_at: "2026-11-01T00:00:00-03:00" }))).toBeNull();
    expect(parseHrEvent(vac({ kind: "sick" }))).toBeNull();
    expect(parseHrEvent({ id: "x" })).toBeNull();
    expect(parseHrEvent(null)).toBeNull();
  });
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("applyHrEvent (Postgres real)", () => {
  const pool = createPool(url!, 2);
  const db = createDb(pool);
  let orgId = "";
  let bru = "";
  beforeAll(async () => {
    const [org] = await db.insert(orgs).values({ name: `Teste RH ${Math.random().toString(36).slice(2, 7)}` }).returning();
    orgId = org!.id;
    const [p] = await db.insert(people).values({ orgId, name: "Bruno", timezone: "America/Sao_Paulo", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" } }).returning();
    bru = p!.id;
    await db.insert(identities).values({ orgId, personId: bru, platform: "rh", externalId: "123" });
  });
  afterAll(async () => {
    await db.delete(orgs).where(eq(orgs.id, orgId));
    await pool.end();
  });

  it("registra a ausência da matrícula ligada; repetir o mesmo id não duplica", async () => {
    const r = await applyHrEvent(db, orgId, parseHrEvent(vac())!);
    expect(r).toMatchObject({ status: "registered", personId: bru });
    expect(await applyHrEvent(db, orgId, parseHrEvent(vac())!)).toEqual({ status: "duplicate" });
    const rows = await db.select().from(absences).where(eq(absences.orgId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "vacation", source: "hr", hrEventId: "evento-1" });
  });

  it("cancelamento marca a ausência; cancelar de novo ou id desconhecido não faz nada", async () => {
    expect(await applyHrEvent(db, orgId, { id: "evento-1", action: "cancel" })).toEqual({ status: "cancelled" });
    expect(await applyHrEvent(db, orgId, { id: "evento-1", action: "cancel" })).toEqual({ status: "unknown_event" });
    const [row] = await db.select().from(absences).where(eq(absences.orgId, orgId));
    expect(row!.cancelledAt).not.toBeNull();
  });

  it("matrícula desconhecida vira só uma contagem, sem matrícula nem datas", async () => {
    expect(await applyHrEvent(db, orgId, parseHrEvent(vac({ id: "evento-2", employee_id: "999" }))!)).toEqual({ status: "unknown_employee" });
    const logs = await db.select().from(auditLog).where(and(eq(auditLog.orgId, orgId), eq(auditLog.action, "rh:matricula_desconhecida")));
    expect(logs).toHaveLength(1);
    expect(logs.map(({ actor, action, target }) => ({ actor, action, target }))).toEqual([{ actor: "rh", action: "rh:matricula_desconhecida", target: "rh:aviso" }]);
  });

  it("segredo da empresa fica cifrado e pode ser trocado", async () => {
    const cipher = new TokenCipher("c".repeat(64));
    expect(await hrSecret(db, cipher, orgId)).toBeNull();
    const s1 = await rotateHrSecret(db, cipher, orgId);
    expect(await hrSecret(db, cipher, orgId)).toBe(s1);
    const s2 = await rotateHrSecret(db, cipher, orgId);
    expect(s2).not.toBe(s1);
    expect(await hrSecret(db, cipher, orgId)).toBe(s2);
  });
});
