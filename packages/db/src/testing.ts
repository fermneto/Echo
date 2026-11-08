// Utilitário de testes: um papel comum do Postgres (sem SUPERUSER e sem BYPASSRLS), como o da aplicação
// em produção. O usuário local e o da CI são superusuários, e superusuário sempre passa pelo RLS.
import type pg from "pg";

const ROLE = "echo_app_test";
const PASSWORD = "echo_app_test";

/**
 * Trava de quem concede permissões nos testes. Dois GRANT em paralelo nas mesmas tabelas falham com
 * "tuple concurrently updated", mesmo para papéis diferentes: todo GRANT de teste passa por ela.
 */
export const GRANT_LOCK = 41_2026_12;

/** Cria (uma vez) o papel comum com acesso às tabelas e devolve a URL para conectar com ele. */
export async function appRoleUrl(adminPool: pg.Pool, adminUrl: string): Promise<string> {
  const client = await adminPool.connect();
  try {
    // Testes de vários pacotes rodam em paralelo: a trava evita criar o papel duas vezes.
    await client.query("select pg_advisory_lock($1)", [GRANT_LOCK]);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS;
        END IF;
      END $$;
      GRANT USAGE ON SCHEMA public TO ${ROLE};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE};
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE};
    `);
  } finally {
    await client.query("select pg_advisory_unlock($1)", [GRANT_LOCK]).catch(() => {});
    client.release();
  }
  const u = new URL(adminUrl);
  u.username = ROLE;
  u.password = PASSWORD;
  return u.toString();
}
