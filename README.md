# Echo

**A resposta não precisa esperar até amanhã.** Cada pessoa da equipe tem um gêmeo digital que conhece o trabalho dela: responde quando ela está ausente (sempre como "Agente de …", com fonte), adianta revisões de PR à noite e ajuda o líder a redistribuir tarefas sem sobrecarregar ninguém.

Powered by Claude.

## Rodar localmente

Requer Node 24, Docker e pnpm (`corepack enable pnpm`).

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres 17 na porta 5433
pnpm db:migrate
pnpm dev            # painel :3000 · API :3001 (/health, /ready)
pnpm typecheck && pnpm test
```

## Estrutura

TypeScript de ponta a ponta num monorepo pnpm + Turborepo: `apps/` (web, api, worker, reviewer), `packages/` (config, observability, db, jobs, …), `infra/` (Dockerfiles e Blueprint da Render). Detalhes em [`CLAUDE.md`](CLAUDE.md) e em [`docs/`](docs/).

## Ferramentas usadas

Claude Code (desenvolvimento), Claude API (Sonnet 5.5, Haiku 5.5, API de lotes, Managed Agents), Next.js, Hono, Postgres, Drizzle, pg-boss, Zod, Vitest, Playwright, Turborepo, Render, Langfuse.
