// Cadastro pelo RH contra o Postgres real (DATABASE_URL), com papel comum (RLS): pessoa criada na empresa
// certa, traços gravados e lidos de volta, e nada visível para outra empresa.
import { randomUUID } from "node:crypto";
import type { AvatarTraits } from "@echo/domain";
import { asSystem, auditLog, createDb, createPool, type Database, orgs, people } from "@echo/db";
import { appRoleUrl } from "@echo/db/testing";
import { LogRunRecorder } from "@echo/observability";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { onboardPerson } from "./onboarding.ts";
import { createPgOnboardingStore, readAvatar } from "./pg-onboarding.ts";

const url = process.env.DATABASE_URL;
const traits: AvatarTraits = { hair: "bun", hairColor: "teal", skin: "s4", eyewear: "none", facialHair: "none", top: "jacket", topColor: "orange", headwear: "none" };

describe.skipIf(!url)("cadastro pelo RH, em Postgres", () => {
  let admin: pg.Pool;
  let app: pg.Pool;
  let db: Database;
  const [org, other] = [randomUUID(), randomUUID()];

  beforeAll(async () => {
    admin = createPool(url!, 2, { defaultScope: "none" });
    await asSystem(createDb(admin), (tx) => tx.insert(orgs).values([{ id: org, name: "Cadastro" }, { id: other, name: "Outra" }]));
    app = createPool(await appRoleUrl(admin, url!), 2, { defaultScope: "none" });
    db = createDb(app);
  });

  afterAll(async () => {
    await asSystem(createDb(admin), (tx) => tx.delete(orgs).where(eq(orgs.id, org)));
    await asSystem(createDb(admin), (tx) => tx.delete(orgs).where(eq(orgs.id, other)));
    await app.end();
    await admin.end();
  });

  it("cria a pessoa com perfil e traços; o bonequinho só é lido dentro da empresa", async () => {
    const flow = onboardPerson({
      store: createPgOnboardingStore(db),
      recorder: new LogRunRecorder(),
      slm: { model: "qwen3:4b-instruct", json: async () => ({ raw: { cargo: "Designer", habilidades: ["Figma"], areas: ["mobile"], idiomas: ["inglês"] } }) },
      vision: async () => ({ model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(traits) }] }) as never,
    });
    const actor = randomUUID();
    const r = await flow({ orgId: org, actorId: actor, name: "Ana Teste", timezone: "America/Sao_Paulo", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }, resumeText: "Figma", photo: { mediaType: "image/png", base64: "AA==" } });

    const [row] = await asSystem(createDb(admin), (tx) => tx.select().from(people).where(eq(people.id, r.personId)));
    expect(row).toMatchObject({ orgId: org, name: "Ana Teste", role: "member", jobTitle: "Designer", skills: ["Figma"], areas: ["mobile"], languages: ["inglês"], avatar: traits });
    expect(await readAvatar(db, org, r.personId)).toEqual(traits);
    expect(await readAvatar(db, other, r.personId)).toBeUndefined();
    // Quem cadastrou fica no audit_log, e conta para o limite por hora só da própria empresa.
    const audit = await asSystem(createDb(admin), (tx) => tx.select().from(auditLog).where(eq(auditLog.target, `person:${r.personId}`)));
    expect(audit.map((a) => [a.actor, a.action])).toEqual([[`person:${actor}`, "pessoa:cadastrar"]]);
    const store = createPgOnboardingStore(db);
    expect(await store.recentCount(org, new Date(Date.now() - 3_600_000))).toBe(1);
    expect(await store.recentCount(other, new Date(Date.now() - 3_600_000))).toBe(0);
  });
});
