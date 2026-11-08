// Estilo e delegação da pessoa em Postgres real (DATABASE_URL): o juiz e o prompt leem o que ela gravou.
import { randomUUID } from "node:crypto";
import { asSystem, createDb, createPool, type Database, fixRuns, orgs, people, pullRequests, reviews } from "@echo/db";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgDelegationOf } from "./pg-fix.ts";
import { createPgAgentData } from "./pg-data.ts";
import { readAgentDecisions, readAgentProfile, readPlanFixes, saveAgentProfile } from "./pg-profile.ts";

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

  it("decisões do agente: a unida pela delegação e a que ficou com a pessoa, com o motivo também no plano", async () => {
    const [pr44, pr45, rv1, rv2, fx1, fx2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [pr48, rv3, fx3] = [randomUUID(), randomUUID(), randomUUID()];
    await asSystem(db, async (tx) => {
      const pr = (id: string, number: number) => ({ id, orgId: org, repository: "teste/app", number, title: `PR ${number}`, authorId: fernando, state: "open", branch: `b${number}`, headSha: `s${number}` });
      await tx.insert(pullRequests).values([pr(pr44, 44), pr(pr45, 45), pr(pr48, 48)]);
      const rv = (id: string, prId: string) => ({ id, orgId: org, prId, headSha: "s", state: "fix_ready", model: "claude-sonnet-5-5", files: ["src/a.ts"], findings: [] });
      await tx.insert(reviews).values([rv(rv1, pr44), rv(rv2, pr45), rv(rv3, pr48)]);
      await tx.insert(fixRuns).values([
        { id: fx1, orgId: org, reviewId: rv1, state: "approved", draftPrNumber: 46, decidedBy: fernando, decidedAt: new Date("2026-11-08T06:00:00Z"), decidedVia: "delegacao", delegationNote: "Unida pela sua delegação de 2026-11-07: correção pequena com testes." },
        { id: fx2, orgId: org, reviewId: rv2, state: "ready", draftPrNumber: 47, testsReported: "passou", delegationNote: "Ficou com você: caminho sensível: src/pagamentos/x.ts." },
        { id: fx3, orgId: org, reviewId: rv3, state: "ready", draftPrNumber: 49, testsReported: "passou", ciWaitSince: new Date("2026-11-08T06:05:00Z"), delegationNote: "Esperando o CI do rascunho para decidir pela sua delegação." },
      ]);
    });
    const decisions = await readAgentDecisions(db, org, fernando);
    expect(decisions.map((d) => [d.prNumber, d.outcome, d.state])).toEqual(expect.arrayContaining([[44, "unida", "approved"], [45, "com_voce", "ready"], [48, "esperando_ci", "ready"]]));
    expect(decisions.find((d) => d.prNumber === 44)!.note).toContain("Unida pela sua delegação");
    expect(await readPlanFixes(db, org, fernando)).toEqual(expect.arrayContaining([expect.objectContaining({ fixId: fx2, draftPrNumber: 47, delegationNote: "Ficou com você: caminho sensível: src/pagamentos/x.ts." }), expect.objectContaining({ fixId: fx3 })]));
  });
});
