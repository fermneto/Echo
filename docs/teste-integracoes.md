# Teste real das integrações

Como validar, com Slack, GitHub e Linear de verdade, a entrada dos avisos (F1) e as ações aprovadas (outbox). Use **só espaços de teste e dados sintéticos**.

O que este teste cobre:

| # | O que acontece de verdade | Onde conferir |
|---|---|---|
| A | Mudança numa tarefa do Linear chega ao Echo | `tasks` e o log do worker |
| B | Push e PR no GitHub chegam ao Echo, sem duplicar | `work_events` e `pull_requests` |
| C | Menção, "alguém sabe…" e reação 🙏 no Slack chegam; conversa comum é descartada | `inbox_events` e `contributions` |
| D | Ação aprovada muda o responsável no Linear, comenta, posta no Slack e comenta no PR | O próprio Linear, Slack e GitHub |
| E | Reenvio do mesmo aviso não duplica; assinatura errada é recusada | `inbox_events` e `curl` |

A resposta do agente no Slack (F2) é da frente Funções: por enquanto a mensagem chega até a fila `slack.message` e para ali.

## 1. Preparar o ambiente local

```bash
pnpm install && cp .env.example .env
pnpm db:up && pnpm db:migrate
```

Os avisos das plataformas precisam de um endereço público que chegue na API (porta 3001). Durante o teste, use um túnel e anote o endereço como `<API>`:

```bash
cloudflared tunnel --url http://localhost:3001      # ou: ngrok http 3001
```

Na Render, `<API>` é o endereço do serviço `echo-api`.

## 2. Criar os apps de teste

### Slack

1. Crie um espaço de teste (plano gratuito).
2. Em [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From a manifest**, escolha o espaço e cole `infra/slack-manifest.yml`, trocando `<API>`.
3. **Install to Workspace**. Copie o **Bot User OAuth Token** (`xoxb-…`) para `SLACK_BOT_TOKEN` e, em **Basic Information**, o **Signing Secret** para `SLACK_SIGNING_SECRET`.
4. O Slack verifica a URL de eventos na hora: a API precisa estar no ar (passo 4) para aparecer **Verified**. Se salvou antes, volte em **Event Subscriptions** e clique em **Retry**.
5. Crie um canal (ex.: `#time-produto`) e rode `/invite @Echo` nele.

### GitHub

1. Crie uma organização de teste (ex.: `<org>-teste`) com um repositório **público** `app` só com dados sintéticos.
2. **Settings → Developer settings → GitHub Apps → New GitHub App**:
   - **Webhook URL:** `https://<API>/webhooks/github` · **Webhook secret:** gere com `openssl rand -hex 20` e copie para `GITHUB_WEBHOOK_SECRET`.
   - **Permissões do repositório:** Contents e Pull requests: *Read and write* · Metadata, Checks e Issues: *Read*. **Da organização:** Members: *Read*.
   - **Eventos:** Push, Pull request, Pull request review, Pull request review comment, Issue comment, Check suite.
3. Anote o **App ID** em `GITHUB_APP_ID`. Gere uma **private key**, e coloque o conteúdo do `.pem` em `GITHUB_PRIVATE_KEY` numa linha só:
   ```bash
   awk 'NF {printf "%s\\n", $0}' chave.pem     # cole o resultado entre aspas no .env
   ```
4. **Install App** na organização de teste, só no repositório `app`.

### Linear

1. Crie um espaço de teste (plano gratuito) com um time e etiquetas de área (ex.: `pagamentos`).
2. Credencial, escolha uma:
   - **Mais rápido:** chave pessoal em **Settings → Security & access → Personal API keys** → `LINEAR_API_KEY`.
   - **Como em produção:** app OAuth em **Settings → API → OAuth applications**, instalado como app (`actor=app`) por um administrador → `LINEAR_CLIENT_ID` e `LINEAR_CLIENT_SECRET`.
3. Webhook: no app OAuth (ou em **Settings → API → Webhooks**), URL `https://<API>/webhooks/linear`, recurso **Issues**. Copie o segredo de assinatura para `LINEAR_WEBHOOK_SECRET`.
4. Crie as tarefas sintéticas da história (ex.: `ECH-1 Tempo limite nos pagamentos`, uma delas sem responsável).

## 3. Conferir as credenciais e pegar os ids

```bash
pnpm integracoes:conferir
```

Saída esperada (com os seus valores):

```
Token ok. Bot: U0BOT · espaço (DEMO_SLACK_TEAM_ID): T0123
3 pessoas no espaço:
  U0AAA  Marina
  U0BBB  Carla
App ok: Echo teste (echo-teste)
  instalação 55555555 em org-teste
Instalação 55555555 (DEMO_GITHUB_INSTALLATION_ID) vê 1 repositórios: org-teste/app
App ok. Organização (DEMO_LINEAR_ORG_ID): 0f0e… · Org teste
2 pessoas (ids para DEMO_IDENTITIES):
  a1b2…  Marina
  c3d4…  Carla
```

Preencha no `.env`:

```bash
DEMO_SLACK_TEAM_ID=T0123
DEMO_GITHUB_INSTALLATION_ID=55555555
DEMO_LINEAR_ORG_ID=0f0e…
DEMO_IDENTITIES='[{"nome":"Marina","papel":"leader","slack":"U0AAA","linear":"a1b2…"},{"nome":"Carla","slack":"U0BBB","github":"carla-teste","linear":"c3d4…"}]'
```

Cada pessoa só recebe as contas que você listar: o Echo nunca adivinha quem é quem.

## 4. Ligar a empresa de teste e subir os serviços

```bash
pnpm integracoes:ligar
```

Esperado: a empresa, cada pessoa com as contas ligadas, as três rotas e a importação das tarefas abertas do Linear e dos PRs abertos do GitHub (pelos adaptadores de leitura).

Suba a API e o worker (em terminais separados, ou `pnpm dev`):

```bash
pnpm --filter @echo/api dev
pnpm --filter @echo/worker dev
```

Para acompanhar o banco: `docker compose exec db psql -U echo -d echo`.

## 5. Testes

### A. Linear → Echo

Mude o estado ou o título de uma tarefa no Linear.

```sql
select key, title, state, assignee_id is not null as tem_responsavel, external_updated_at from tasks order by updated_at desc limit 5;
```

No log do worker aparece `"flow":"inbox" … "result":"ok"`.

### B. GitHub → Echo

```bash
git clone https://github.com/<org>-teste/app && cd app
git checkout -b ech-1-tempo-limite
echo "// teste" >> README.md && git commit -am "ECH-1: teste de integração" && git push -u origin ech-1-tempo-limite
gh pr create --title "ECH-1: tempo limite" --body "teste"
```

```sql
select type, branch, task_key, person_id is not null as pessoa_ligada, source_ref from work_events order by created_at desc limit 5;
select number, state, branch, task_key from pull_requests order by updated_at desc limit 3;
```

Esperado: um `commit` com `task_key = ECH-1` e `pessoa_ligada = t` se o login do autor estiver em `DEMO_IDENTITIES`; um `pr_opened`; o PR em `pull_requests`.

### C. Slack → Echo

No canal com o bot:

1. `@Carla posso seguir com a ech-1?` → entra (cita pessoa cadastrada).
2. `alguém sabe de pagamentos?` → entra (quem sabe).
3. `bom dia, time` → **descartada na entrada**, nada gravado.
4. Carla escreve algo; Marina reage com 🙏 → vira ajuda confirmada.

```sql
select state, payload->'body'->'event'->>'type' as tipo, payload->'body'->'event'->>'text' as texto from inbox_events where source = 'slack' order by received_at desc limit 5;
select kind, source_ref, confirmed from contributions order by occurred_at desc limit 3;
```

Esperado: três linhas (as duas mensagens e a reação), `texto` vazio depois de processadas (o texto não fica guardado), e a ajuda com `source_ref` = `<canal>:<ts>`, sem texto.

### D. Ações aprovadas (outbox) → Linear, Slack e GitHub

Pegue o id do canal (clique no nome do canal → o id `C…` aparece no fim do painel) e rode:

```bash
pnpm acao:testar --tarefa ECH-1 --para "Carla" --aprovador "Marina" --canal C0123 --pr <org>-teste/app#1
```

Saída esperada:

```
1. Ação no outbox, aguardando aprovação: mudar ECH-1 para Carla
2. Execução antes de aprovar: 0 feitas (esperado: 0)
3. Aprovada por Marina
4. Executadas: 4 · falharam: 0 · para tentar de novo: 0
   done     linear.assign    linear:ECH-1
   done     linear.comment   linear:ECH-1
   done     slack.post       slack:C0123
   done     github.comment   github:<org>-teste/app#1
```

Confira nas plataformas: no Linear, ECH-1 com Carla como responsável e o comentário do Echo; no Slack, a mensagem do Echo no canal; no GitHub, o comentário no PR. O aviso do Linear sobre a mudança volta pelo passo A e confirma o espelho.

Casos que devem **falhar com motivo**, sem tocar nas plataformas:

```bash
pnpm acao:testar --tarefa ECH-1 --para "Marina" --aprovador "Marina"   # se Marina não tiver "linear": "pessoa sem conta no Linear"
```

```sql
select type, target, state, attempts, error, approved_by is not null as aprovada from outbox_actions order by created_at desc limit 8;
select actor, action, target, created_at from audit_log order by created_at desc limit 8;
```

### E. Idempotência e assinatura

- **GitHub:** no app, **Advanced → Recent Deliveries** → abra uma entrega → **Redeliver**. Rode de novo a consulta do teste B: nenhuma linha nova.
- **Slack e Linear:** o mesmo vale quando a plataforma tenta de novo (a chave única é o `event_id` e o `Linear-Delivery`).
- **Assinatura errada:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<API>/webhooks/github \
  -H "x-github-event: push" -H "x-github-delivery: falso-1" -H "x-hub-signature-256: sha256=00" -d '{}'
# esperado: 401
```

## Se algo der errado

| Sintoma | Causa provável |
|---|---|
| Rota responde 503 | Segredo do webhook ausente no `.env` da API |
| 401 em todo aviso | Segredo diferente do configurado na plataforma, ou relógio do computador errado (Slack recusa mais de 5 min de diferença) |
| Aviso chega mas `inbox_events` fica vazio | Rota não ligada: rode `pnpm integracoes:ligar` com o `DEMO_*_…` certo (aviso de empresa desconhecida é descartado) |
| Slack: mensagem não aparece | Bot não convidado no canal, ou a mensagem não cita pessoa cadastrada / não é "quem sabe" (descarte proposital) |
| Slack `not_in_channel` no teste D | `/invite @Echo` no canal |
| Slack `missing_scope` | Faltou escopo no manifesto: reinstale o app depois de mudar escopos |
| GitHub 404 "Integration not found" | `GITHUB_APP_ID` errado, ou chave de outro app |
| GitHub 403 ao comentar | App sem *Pull requests: Read and write*, ou não instalado no repositório |
| Linear `pessoa sem conta no Linear` | Faltou `"linear"` dessa pessoa em `DEMO_IDENTITIES` (a tarefa só vai para quem tem conta) |
| Linear `tarefa … sem id no Linear` | Tarefa não importada: rode `pnpm integracoes:ligar` de novo |
