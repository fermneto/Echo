# Render (hospedagem do evento)

## O que fica no ar

O Blueprint `infra/render.yaml` cria:

| Serviço | Tipo | O que faz |
|---|---|---|
| `echo-db` | Postgres 17 | O banco, com RLS |
| `echo-api` | web | Webhooks e API |
| `echo-web` | web | O painel, que é o link para quem testa |
| `echo-worker` | worker | Caixa de entrada, respostas, ações, reconciliação e agenda |
| `echo-reviewer` | worker | Correções e vídeos (etapas 10 e 27). Comentado no Blueprint até ser ligado |

**Custo:** banco, API e painel no plano gratuito; só o `echo-worker` no `starter` (US$ 7 por mês), porque a Render não tem worker gratuito. O banco gratuito expira 30 dias depois de criado, e API e painel hibernam depois de ~15 min parados. Confira os preços atuais antes de criar.

**Migração antes do deploy:** o plano gratuito não roda comando antes do deploy. Por isso o deploy sai do GitHub Actions (`.github/workflows/deploy.yml`): com o CI verde na `main`, ele migra o banco da Render e só então chama o Deploy Hook de cada serviço, no mesmo commit. Sem isso, um PR com migração publica código que usa uma coluna que ainda não existe.

## Criar

1. Na Render, ligue o repositório e crie um **Blueprint** apontando para `infra/render.yaml`.
2. As variáveis marcadas como `sync: false` são pedidas na criação. As que entrarem depois vão no painel de cada serviço.
3. Anote os endereços públicos do `echo-api` (`<API>`) e do `echo-web` (`<PAINEL>`). Troque as URLs do túnel por eles no Slack, no GitHub App, no Linear e na Vercel.

## Deploy pelo GitHub Actions

Uma vez, depois de criar o Blueprint:

1. Em cada serviço (`echo-api`, `echo-web`, `echo-worker`): **Settings → Auto-Deploy → Off**, e copie o **Deploy Hook** (`https://api.render.com/deploy/srv-…?key=…`).
2. No repositório do GitHub, em **Settings → Secrets and variables → Actions**, crie:

   | Segredo | Valor |
   |---|---|
   | `RENDER_DATABASE_URL` | External Database URL do `echo-db` |
   | `RENDER_DEPLOY_HOOK_API` | Deploy Hook do `echo-api` |
   | `RENDER_DEPLOY_HOOK_WEB` | Deploy Hook do `echo-web` |
   | `RENDER_DEPLOY_HOOK_WORKER` | Deploy Hook do `echo-worker` |

3. Teste em **Actions → Deploy na Render → Run workflow**. O passo da migração mostra `Migrações aplicadas`, e os três serviços começam um deploy na Render.

Daí em diante, cada merge na `main` com o CI verde migra e publica sozinho.

## Variáveis por serviço

| Serviço | Variáveis |
|---|---|
| `echo-api` | `GITHUB_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `LINEAR_WEBHOOK_SECRET`, `VERCEL_WEBHOOK_SECRET`, `ENCRYPTION_KEY` (o `DATABASE_URL` vem do banco) |
| `echo-web` | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `PANEL_URL`, `DEMO_SLACK_TEAM_ID`, `ANTHROPIC_API_KEY` (o `SESSION_SECRET` é gerado, e o `DATABASE_URL` vem do banco) |
| `echo-worker` | `SLACK_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `BRAINS_REPOSITORY`, `LINEAR_API_KEY` (ou `LINEAR_CLIENT_ID` e `LINEAR_CLIENT_SECRET`), `WEB_URL`, `GOOGLE_SERVICE_ACCOUNT_*`, `MICROSOFT_CLIENT_*`, `ENCRYPTION_KEY`; `DEMO_ALWAYS_AWAY=true` só para ensaiar de dia |
| Todos (grupo `echo-shared`) | `LOG_LEVEL`, `DEMO_MODE=true`, `LANGFUSE_*` (opcional) |

A `ENCRYPTION_KEY` precisa ser **igual** na API e no worker. Trocar a chave invalida as credenciais guardadas, como o segredo do RH.

## Ligar a empresa de teste no banco da Render

Use a URL externa do banco, que está no painel da Render:

```bash
DATABASE_URL='<URL externa>?sslmode=no-verify' pnpm integracoes:ligar
DATABASE_URL='<URL externa>?sslmode=no-verify' pnpm db:seed     # se for usar a empresa de demonstração
```

## Validar

1. `curl -s https://<API>/ready` → `{"ok":true,"checks":{"db":true}}`.
2. Logs do `echo-worker`: `worker no ar`, `reviewer respondeu ao ping` e um heartbeat a cada 30 s.
3. **O teste mais importante do manual:** com os computadores de todo mundo desligados, faça uma pergunta pelo celular, no Slack (guia do Slack, S2). A resposta precisa chegar.
4. Refaça os testes dos outros guias contra os endereços da Render.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Fila do worker falha com `column … does not exist` | O código novo foi publicado antes da migração: rode **Deploy na Render** em Actions (ou `DATABASE_URL='<URL externa>?sslmode=no-verify' pnpm db:migrate`) e confira se o Auto-Deploy está desligado |
| `SSL/TLS required` ao conectar de fora | Falta `?sslmode=no-verify` na URL externa |
| O worker reinicia sem parar | Falta uma variável obrigatória: o log mostra `Configuração inválida em "worker"` com a lista |
| O login do painel falha na Render | `PANEL_URL` e a Redirect URL do Slack ainda apontam para o túnel |
