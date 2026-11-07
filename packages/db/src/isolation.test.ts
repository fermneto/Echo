// Teste de isolamento (etapa 2): uma empresa não lê nem referencia linhas de outra.
// Roda contra o Postgres real (DATABASE_URL), depois de `pnpm db:migrate`.
// O usuário do banco local e da CI é superusuário, e superusuário sempre passa pelo RLS. Por isso o teste
// cria um papel comum (sem BYPASSRLS), como o da aplicação em produção, e consulta com ele.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createPool, type Database } from "./client.ts";
import { orgs, people, tasks } from "./schema.ts";
import { asSystem, withOrg } from "./tenant.ts";

const url = process.env.DATABASE_URL;

/** O Drizzle embrulha o erro do Postgres em "Failed query"; a causa traz a mensagem do banco. */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  return "não falhou";
}
const ROLE = "echo_rls_test";
const PASSWORD = "echo_rls_test";

describe.skipIf(!url)("isolamento entre empresas (RLS e chaves compostas)", () => {
  let adminPool: pg.Pool;
  let admin: Database;
  let appPool: pg.Pool; // padrão da transição: fora de withOrg passa pelo RLS
  let app: Database;
  let strictPool: pg.Pool; // padrão final: fora de withOrg não vê nada
  let strict: Database;

  const A = { org: randomUUID(), person: randomUUID(), task: randomUUID() };
  const B = { org: randomUUID(), person: randomUUID(), task: randomUUID() };
  const hours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" };

  beforeAll(async () => {
    adminPool = createPool(url!, 2);
    admin = createDb(adminPool);
    await adminPool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO ${ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};
    `);
    const roleUrl = new URL(url!);
    roleUrl.username = ROLE;
    roleUrl.password = PASSWORD;
    appPool = createPool(roleUrl.toString(), 2);
    app = createDb(appPool);
    strictPool = createPool(roleUrl.toString(), 2, { defaultScope: "none" });
    strict = createDb(strictPool);

    await asSystem(admin, async (tx) => {
      for (const [name, x] of [["Empresa A", A], ["Empresa B", B]] as const) {
        await tx.insert(orgs).values({ id: x.org, name });
        await tx.insert(people).values({ id: x.person, orgId: x.org, name: `Pessoa de ${name}`, timezone: "America/Sao_Paulo", workHours: hours });
        await tx.insert(tasks).values({ id: x.task, orgId: x.org, key: "ISO-1", title: `Tarefa de ${name}`, state: "todo", assigneeId: x.person });
      }
    });
  });

  afterAll(async () => {
    if (admin) await asSystem(admin, (tx) => tx.delete(orgs).where(eq(orgs.id, A.org)).then(() => tx.delete(orgs).where(eq(orgs.id, B.org))));
    await Promise.allSettled([adminPool?.end(), appPool?.end(), strictPool?.end()]);
  });

  it("dentro de withOrg, cada empresa só lê as próprias linhas", async () => {
    const seen = await withOrg(app, A.org, async (tx) => ({
      orgs: (await tx.select({ id: orgs.id }).from(orgs)).map((r) => r.id),
      people: (await tx.select({ id: people.id }).from(people)).map((r) => r.id),
      tasks: (await tx.select({ id: tasks.id }).from(tasks)).map((r) => r.id),
    }));
    expect(seen.orgs).toEqual([A.org]);
    expect(seen.people).toEqual([A.person]);
    expect(seen.tasks).toEqual([A.task]);
  });

  it("não grava linha em nome de outra empresa", async () => {
    expect(await failure(withOrg(app, A.org, (tx) => tx.insert(tasks).values({ orgId: B.org, key: "ISO-2", title: "Intrusa", state: "todo" })))).toMatch(/row-level security/i);
  });

  it("não altera nem apaga linhas de outra empresa", async () => {
    const result = await withOrg(app, A.org, async (tx) => {
      const updated = await tx.update(tasks).set({ title: "Alterada" }).where(eq(tasks.id, B.task)).returning({ id: tasks.id });
      const deleted = await tx.delete(tasks).where(eq(tasks.id, B.task)).returning({ id: tasks.id });
      return { updated: updated.length, deleted: deleted.length };
    });
    expect(result).toEqual({ updated: 0, deleted: 0 });
    const [still] = await asSystem(admin, (tx) => tx.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, B.task)));
    expect(still?.title).toBe("Tarefa de Empresa B");
  });

  it("não referencia pessoa de outra empresa, nem como sistema (chave composta)", async () => {
    expect(await failure(asSystem(admin, (tx) => tx.insert(tasks).values({ orgId: A.org, key: "ISO-3", title: "Cruzada", state: "todo", assigneeId: B.person })))).toMatch(/foreign key/i);
  });

  it("fora de withOrg, no modo estrito, as tabelas de negócio ficam vazias", async () => {
    const rows = await strict.select({ id: people.id }).from(people).where(eq(people.id, A.person));
    expect(rows).toHaveLength(0);
    expect(await failure(strict.insert(orgs).values({ name: "Sem contexto" }))).toMatch(/row-level security/i);
  });

  it("asSystem enxerga as duas empresas", async () => {
    const ids = await asSystem(app, async (tx) => (await tx.select({ id: people.id }).from(people)).map((r) => r.id));
    expect(ids).toEqual(expect.arrayContaining([A.person, B.person]));
  });

  it("withOrg recusa um org_id que não é uuid", async () => {
    await expect(withOrg(app, "'; drop table orgs; --", async () => 1)).rejects.toThrow(/org_id inválido/);
  });
});
