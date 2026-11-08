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
import { cleanProfile, onboardPerson } from "./onboarding.ts";
import { createPgOnboardingStore, readAvatar, updateProfile } from "./pg-onboarding.ts";

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
    const r = await flow({ orgId: org, name: "Ana Teste", timezone: "America/Sao_Paulo", workHours: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }, resumeText: "Figma", photo: { mediaType: "image/png", base64: "AA==" } });

    const [row] = await asSystem(createDb(admin), (tx) => tx.select().from(people).where(eq(people.id, r.personId)));
    expect(row).toMatchObject({ orgId: org, name: "Ana Teste", role: "member", jobTitle: "Designer", skills: ["Figma"], areas: ["mobile"], languages: ["inglês"], avatar: traits });
    expect(await readAvatar(db, org, r.personId)).toEqual(traits);
    expect(await readAvatar(db, other, r.personId)).toBeUndefined();
  });

  it("perfil editado na ficha: grava validado, registra quem editou e não atravessa empresa", async () => {
    const id = randomUUID();
    await asSystem(createDb(admin), (tx) => tx.insert(people).values({ id, orgId: org, name: "Bia Teste", role: "member", timezone: "Europe/Lisbon", workHours: { days: [1], start: "09:00", end: "18:00" } }));
    const profile = cleanProfile({ jobTitle: "Analista de dados", skills: ["SQL", "bia@exemplo.com"], areas: ["dados"], languages: ["Inglês"] });
    expect(await updateProfile(db, org, id, profile, "rh-1")).toBe(true);
    expect(await updateProfile(db, other, id, profile, "rh-1")).toBe(false);

    const [row] = await asSystem(createDb(admin), (tx) => tx.select().from(people).where(eq(people.id, id)));
    expect(row).toMatchObject({ jobTitle: "Analista de dados", skills: ["SQL"], areas: ["dados"], languages: ["inglês"] });
    const audit = await asSystem(createDb(admin), (tx) => tx.select().from(auditLog).where(eq(auditLog.target, `person:${id}`)));
    expect(audit.map((a) => [a.orgId, a.actor, a.action])).toEqual([[org, "person:rh-1", "perfil:editar"]]);
  });
});
