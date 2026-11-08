// Contas da pessoa (identities) contra o Postgres real (DATABASE_URL), com papel comum (RLS): cadastro já com as
// contas, troca na ficha, conta de outra pessoa recusada sem mudar nada, e nada atravessa empresa.
import { randomUUID } from "node:crypto";
import { parseAccounts } from "@echo/domain";
import { asSystem, auditLog, createDb, createPool, type Database, identities, orgs, people } from "@echo/db";
import { appRoleUrl } from "@echo/db/testing";
import { LogRunRecorder } from "@echo/observability";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onboardPerson } from "./onboarding.ts";
import { AccountConflictError, readAccounts, saveAccounts } from "./pg-accounts.ts";
import { createPgOnboardingStore } from "./pg-onboarding.ts";

const url = process.env.DATABASE_URL;
const links = (input: Parameters<typeof parseAccounts>[0]) => {
  const r = parseAccounts(input);
  if (!r.ok) throw new Error(r.error);
  return r.links;
};
const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

describe.skipIf(!url)("contas da pessoa, em Postgres", () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let db: Database;
  const [org, other] = [randomUUID(), randomUUID()];
  const actor = randomUUID();

  beforeAll(async () => {
    admin = createPool(url!, 2, { defaultScope: "none" });
    await asSystem(createDb(admin), (tx) => tx.insert(orgs).values([{ id: org, name: "Contas" }, { id: other, name: "Outra" }]));
    app = createPool(await appRoleUrl(admin, url!), 2, { defaultScope: "none" });
    db = createDb(app);
  });

  afterAll(async () => {
    await asSystem(createDb(admin), (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await asSystem(createDb(admin), (tx) => tx.delete(orgs).where(eq(orgs.id, other)));
    await app.end();
    await admin.end();
  });

  const flow = () => onboardPerson({ store: createPgOnboardingStore(db), recorder: new LogRunRecorder() });

  it("o cadastro cria a pessoa já com as contas; conta de outra pessoa desfaz o cadastro inteiro", async () => {
    const r = await flow()({ orgId: org, actorId: actor, name: "Ana Contas", timezone: "America/Sao_Paulo", workHours: hours, accounts: links({ slack: "U0ANA0001", github: "ana-dev" }) });
    expect(await readAccounts(db, org, r.personId)).toEqual({ slack: { externalId: "U0ANA0001", login: null }, github: { externalId: "login:ana-dev", login: "ana-dev" } });
    // A outra empresa não vê as contas.
    expect(await readAccounts(db, other, r.personId)).toEqual({});

    const recorder = new LogRunRecorder();
    const dup = onboardPerson({ store: createPgOnboardingStore(db), recorder });
    await expect(dup({ orgId: org, actorId: actor, name: "Bia Contas", timezone: "America/Sao_Paulo", workHours: hours, accounts: links({ slack: "U0ANA0001" }) })).rejects.toBeInstanceOf(AccountConflictError);
    // Mesmo login do GitHub com outra caixa também é da Ana.
    await expect(dup({ orgId: org, actorId: actor, name: "Bia Contas", timezone: "America/Sao_Paulo", workHours: hours, accounts: links({ github: "ANA-DEV" }) })).rejects.toMatchObject({ platform: "github", otherName: "Ana Contas" });
    const bia = await asSystem(createDb(admin), (tx) => tx.select().from(people).where(eq(people.name, "Bia Contas")));
    expect(bia).toEqual([]);
    expect(recorder.runs.filter((x) => x.flow === "onboarding").map((x) => x.result)).toEqual(["failed", "failed"]);
  });

  it("a ficha troca as contas, registra quem trocou sem os ids e recusa conta de outra pessoa", async () => {
    const [ana] = await asSystem(createDb(admin), (tx) => tx.select().from(people).where(eq(people.name, "Ana Contas")));
    const caio = (await flow()({ orgId: org, actorId: actor, name: "Caio Contas", timezone: "America/Sao_Paulo", workHours: hours })).personId;
    expect(await readAccounts(db, org, caio)).toEqual({});

    expect(await saveAccounts(db, org, caio, links({ slack: "U0CAIO001", linear: "6f1c2d3e-1111-4222-8333-444455556666" }), actor)).toEqual({ status: "saved" });
    expect(await readAccounts(db, org, caio)).toMatchObject({ slack: { externalId: "U0CAIO001" }, linear: { externalId: "6f1c2d3e-1111-4222-8333-444455556666" } });
    // Trocar o Slack e tirar o Linear.
    expect(await saveAccounts(db, org, caio, links({ slack: "U0CAIO002" }), actor)).toEqual({ status: "saved" });
    expect(await readAccounts(db, org, caio)).toEqual({ slack: { externalId: "U0CAIO002", login: null } });

    expect(await saveAccounts(db, org, caio, links({ slack: "U0ANA0001" }), actor)).toEqual({ status: "conflict", platform: "slack", otherName: "Ana Contas" });
    expect(await readAccounts(db, org, caio)).toEqual({ slack: { externalId: "U0CAIO002", login: null } });
    expect(await readAccounts(db, org, ana!.id)).toMatchObject({ slack: { externalId: "U0ANA0001" } });

    // Outra empresa não acha a pessoa nem grava.
    expect(await saveAccounts(db, other, caio, links({ slack: "U0OUTRA01" }), actor)).toEqual({ status: "not_found" });
    const all = await asSystem(createDb(admin), (tx) => tx.select().from(identities).where(eq(identities.externalId, "U0OUTRA01")));
    expect(all).toEqual([]);

    const audit = await asSystem(createDb(admin), (tx) => tx.select().from(auditLog).where(eq(auditLog.target, `person:${caio}`)));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["pessoa:cadastrar", "pessoa:contas:linear,slack", "pessoa:contas:slack"]));
    expect(JSON.stringify(audit)).not.toContain("U0CAIO");
  });
});
