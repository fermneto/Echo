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

- **Desenvolvimento:** Claude Code.
- **Modelos e APIs da Anthropic:** Claude Sonnet 5.5, Claude Opus 5.5 e Claude Haiku 5.5, API de lotes, Managed Agents e Files API.
- **Modelo aberto:** Qwen3 4B Instruct (Apache 2.0), servido pelo Ollama.
- **Vídeo da semana:** Playwright (gravação), Piper (narração com voz aberta em pt-BR) e ffmpeg.
- **APIs das plataformas:** Slack, GitHub (GitHub App e Actions), Linear, Jira Cloud, Google Calendar, Microsoft 365 e Vercel.
- **Aplicação:** TypeScript, Node.js, Next.js, React, Hono, Postgres, Drizzle, pg-boss, Zod, Pino, GSAP, Satori e resvg (imagem do resumo), unpdf (leitura do currículo) e simple-icons.
- **Observabilidade:** Langfuse e OpenTelemetry.
- **Testes e build:** Vitest, Playwright, pnpm, Turborepo e Docker.
- **Hospedagem e CI:** Render e GitHub Actions.
