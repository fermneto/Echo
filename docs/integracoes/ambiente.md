# Ambiente local e túnel

Base de todos os outros guias.

## Preparar

```bash
corepack enable pnpm            # Node 24 e Docker instalados
pnpm install && cp .env.example .env
pnpm db:up && pnpm db:migrate   # Postgres 17 na porta 5433
pnpm typecheck && pnpm test     # tudo verde antes de ligar qualquer plataforma
```

## Expor a API para os avisos das plataformas

Slack, GitHub, Linear, Vercel e o sistema de RH chamam a API (porta 3001) por um endereço público. Use um túnel só durante o desenvolvimento: nada em produção depende dele.

```bash
cloudflared tunnel --url http://localhost:3001     # ou: ngrok http 3001
```

Anote o endereço como `<API>` (ex.: `https://abc.trycloudflare.com`). O login do painel usa o endereço do painel, a porta 3000 (`<PAINEL>`). Se for testar o login (guia do Slack), abra um segundo túnel para a 3000.

> O endereço do túnel muda a cada vez que ele sobe. Ao trocar, atualize as URLs no app do Slack, no GitHub App, no Linear e na Vercel.

## Subir os serviços

Em terminais separados:

```bash
pnpm --filter @echo/api dev      # webhooks e API
pnpm --filter @echo/worker dev   # caixa de entrada, respostas, ações, reconciliação e agenda
pnpm --filter @echo/web dev      # painel (opcional)
```

Esperado no log: `api no ar`, `worker no ar` e `reviewer respondeu ao ping` (com o reviewer: `pnpm --filter @echo/reviewer dev`).

Se faltar algum segredo, o serviço avisa qual. Por exemplo, `segredo de webhook ausente: a rota responde 503`.

## Conferir que a API está no ar pelo túnel

```bash
curl -s https://<API>/health   # {"ok":true,"service":"api",…}
curl -s https://<API>/ready    # {"ok":true,"checks":{"db":true}}
```

Coloque o endereço no `.env` como `API_PUBLIC_URL=https://<API>`. O diagnóstico usa esse endereço para conferir a API.

## Simular as plataformas antes de ligá-las

Com só os segredos de webhook no `.env` (podem ser valores de teste, como `openssl rand -hex 20`) e com a API e o worker no ar:

```bash
pnpm integracoes:simular
# ✔ GitHub: push vira commit da pessoa certa
# ✔ Linear: tarefa chega com o responsável certo
# ✔ Slack: reação 🙏 vira ajuda confirmada, sem texto
# ✔ Vercel: deploy de preview registrado
pnpm integracoes:simular --limpar
```

Depois, use **o mesmo segredo** na configuração de cada plataforma.

## Assinatura errada é sempre recusada

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<API>/webhooks/github \
  -H "x-github-event: push" -H "x-github-delivery: falso-1" -H "x-hub-signature-256: sha256=00" -d '{}'
# 401 (ou 503, se GITHUB_WEBHOOK_SECRET não estiver no .env)
```
