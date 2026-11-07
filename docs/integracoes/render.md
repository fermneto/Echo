# Render (hospedagem do evento)

## O que fica no ar

O Blueprint `infra/render.yaml` cria:

| Serviço | Tipo | O que faz |
|---|---|---|
| `echo-db` | Postgres 17 | O banco, com RLS |
| `echo-api` | web | Webhooks e API. Roda a migração antes de cada deploy (`node /app/packages/db/src/migrate.ts`) |
| `echo-web` | web | O painel, que é o link para quem testa |
| `echo-worker` | worker | Caixa de entrada, respostas, ações, reconciliação e agenda |
| `echo-reviewer` | worker | Correções e vídeos (etapas 10 e 27) |

**Custo:** o Blueprint usa o plano `starter` nos quatro serviços (US$ 7 por mês cada) e o banco `basic-256mb`. Os processos em segundo plano e o comando de migração antes do deploy não rodam no plano gratuito. Confira os preços atuais antes de criar.

## Criar

1. Na Render, ligue o repositório e crie um **Blueprint** apontando para `infra/render.yaml`.
2. As variáveis marcadas como `sync: false` são pedidas na criação. As que entrarem depois vão no painel de cada serviço.
3. Anote os endereços públicos do `echo-api` (`<API>`) e do `echo-web` (`<PAINEL>`). Troque as URLs do túnel por eles no Slack, no GitHub App, no Linear e na Vercel.

## Variáveis por serviço

| Serviço | Variáveis |
|---|---|
| `echo-api` | `GITHUB_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `LINEAR_WEBHOOK_SECRET`, `VERCEL_WEBHOOK_SECRET`, `ENCRYPTION_KEY` (o `DATABASE_URL` vem do banco) |
| `echo-web` | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `PANEL_URL`, `DEMO_SLACK_TEAM_ID` (o `SESSION_SECRET` é gerado, e o `DATABASE_URL` vem do banco) |
| `echo-worker` | `SLACK_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `GOOGLE_SERVICE_ACCOUNT_*`, `MICROSOFT_CLIENT_*`, `ENCRYPTION_KEY` |
| Todos (grupo `echo-shared`) | `LOG_LEVEL`, `DEMO_MODE=true`, `LANGFUSE_*` (opcional) |

A `ENCRYPTION_KEY` precisa ser **igual** na API e no worker. Trocar a chave invalida as credenciais guardadas, como o segredo do RH.

## Ligar a empresa de teste no banco da Render

Use a URL externa do banco, que está no painel da Render:

```bash
DATABASE_URL='<URL externa>?sslmode=require' pnpm integracoes:ligar
DATABASE_URL='<URL externa>?sslmode=require' pnpm db:seed     # se for usar a empresa de demonstração
```

## Validar

1. `curl -s https://<API>/ready` → `{"ok":true,"checks":{"db":true}}`.
2. Logs do `echo-worker`: `worker no ar`, `reviewer respondeu ao ping` e um heartbeat a cada 30 s.
3. **O teste mais importante do manual:** com os computadores de todo mundo desligados, faça uma pergunta pelo celular, no Slack (guia do Slack, S2). A resposta precisa chegar.
4. Refaça os testes dos outros guias contra os endereços da Render.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| O deploy da API falha na migração | O `preDeployCommand` exige o plano pago, ou o `DATABASE_URL` não está ligado ao banco |
| O worker reinicia sem parar | Falta uma variável obrigatória: o log mostra `Configuração inválida em "worker"` com a lista |
| O login do painel falha na Render | `PANEL_URL` e a Redirect URL do Slack ainda apontam para o túnel |
