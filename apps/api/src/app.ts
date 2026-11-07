import { Hono } from "hono";

export interface AppDeps {
  /** Verifica dependências essenciais (banco). */
  ready: () => Promise<boolean>;
  version?: string | undefined;
}

/** Rotas da API. Sem regra de negócio aqui: só conecta pacotes. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "api", version: deps.version ?? "dev" }));

  app.get("/ready", async (c) => {
    const db = await deps.ready().catch(() => false);
    return c.json({ ok: db, checks: { db } }, db ? 200 : 503);
  });

  app.notFound((c) => c.json({ error: "não encontrado" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "erro interno" }, 500);
  });

  return app;
}
