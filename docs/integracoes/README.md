# Integrações: configuração e validação

Um guia por plataforma. Todos seguem a mesma estrutura: o que o Echo faz com ela, de quais PRs depende, como criar a conta, as variáveis, como conferir as credenciais, como validar (com o resultado esperado) e os problemas comuns.

Use **só espaços de teste e dados sintéticos**. A situação geral e os bloqueios estão em [`../pendencias.md`](../pendencias.md).

## Ordem de criação (por dependência)

Cada passo só depende dos anteriores. A maior dependência são os **endereços públicos**: Slack, GitHub, Linear e Vercel pedem a URL da API, e o Slack pede a do painel em `https`.

| # | Passo | Precisa de | Produz |
|---|---|---|---|
| 1 | **Segredos locais:** `ENCRYPTION_KEY`, `SESSION_SECRET` e `GITHUB_WEBHOOK_SECRET` (`openssl rand -hex …`) | — | 3 variáveis |
| 2 | **Endereços públicos** da API (`<API>`) e do painel (`<PAINEL>`), ver [ambiente](ambiente.md) e [Render](render.md) | 1 | `API_PUBLIC_URL`, `PANEL_URL` |
| 3 | **Pessoas de teste e e-mails.** Se for usar o Google ou a Microsoft, crie as pessoas lá primeiro e use esses e-mails nos convites seguintes | — | lista de pessoas |
| 4 | **Anthropic:** chave de API com limite de gasto ([guia](anthropic.md)) | — | `ANTHROPIC_API_KEY` |
| 5 | **Slack:** espaço → app pelo manifesto, com `<API>` e `<PAINEL>` → instalar → convidar as pessoas → canal com `/invite @Echo` ([guia](slack.md)) | 2, 3 | `SLACK_*`, ids `U…`, `DEMO_SLACK_TEAM_ID` |
| 6 | **Validar o Slack:** colocar o signing secret no `.env`, reiniciar a API e clicar em **Retry** em Event Subscriptions | 5 | Request URL verificada |
| 7 | **GitHub:** organização → repositórios `app` e `brains` → GitHub App, com `<API>` e o segredo do passo 1 → chave privada → instalar nos dois repositórios ([guia](github.md)) | 1, 2, 3 | `GITHUB_*`, logins, `DEMO_GITHUB_INSTALLATION_ID` |
| 8 | **Linear:** espaço → convidar as pessoas → chave de API → webhook para `<API>` (o segredo aparece depois de criar) → reiniciar a API → tarefas sintéticas ([guia](linear.md)) | 2, 3 | `LINEAR_*`, ids das pessoas, `DEMO_LINEAR_ORG_ID` |
| 8b | **Jira** (no lugar do Linear): site do Jira Cloud → projeto → token de API → webhook com segredo para `<API>` → tarefas sintéticas ([guia](jira.md)) | 2, 3 | `JIRA_*`, accountId das pessoas, `DEMO_JIRA_SITE` |
| 9 | **Vercel** (opcional): importar o repositório `app` → webhook para `<API>` ([guia](cicd.md)) | 2, 7 | `VERCEL_WEBHOOK_SECRET`, `DEMO_VERCEL_TEAM_ID` |
| 10 | **Agenda** (opcional): conta de serviço do Google ou app da Microsoft, com o consentimento do administrador ([Google](agenda-google.md), [Microsoft](agenda-microsoft.md)) | 3 | credenciais e domínio ou tenant |
| 11 | **`DEMO_IDENTITIES`** com os ids de cada pessoa → `pnpm integracoes:diagnostico` → `pnpm integracoes:ligar` | 5, 7, 8 (e 10) | empresa de teste no banco |
| 12 | **Aviso de RH:** matrículas em `DEMO_IDENTITIES`, depois `pnpm integracoes:rh` ([guia](rh.md)) | 1, 11 | URL e segredo do RH |
| 13 | **Testes de cada guia**, na ordem Slack → GitHub → Linear → Anthropic → RH → agenda → CI/CD | 11 | validação |
| 14 | **Render**, se no passo 2 você usou um túnel: criar o Blueprint e **trocar os endereços** no Slack (eventos, interatividade e Redirect URL), no GitHub App, no Linear e na Vercel. Depois, rodar `integracoes:ligar` no banco da Render | tudo | Echo no ar |

**Endereços no passo 2:** há três opções.
- **Render primeiro:** endereços fixos (`echo-api.onrender.com` e `echo-web.onrender.com`), sem trocar nada depois. Os serviços sobem sem os segredos das plataformas (as rotas respondem 503 até eles entrarem). Custa o plano pago (B7).
- **Túnel com nome fixo:** Cloudflare Tunnel com um domínio seu, ou ngrok com domínio estático. Grátis, e os endereços não mudam.
- **Túnel rápido** (`cloudflared tunnel --url …`): o endereço muda a cada vez, e é preciso atualizá-lo nos passos 5, 7, 8 e 9.

Os PRs de que cada guia depende:

| Guia | Depende dos PRs |
|---|---|
| [Ambiente local e túnel](ambiente.md) | `main` |
| [Slack](slack.md) | #3, #11, #19 |
| [GitHub](github.md) e [Linear](linear.md) | #5, #7, #8 |
| [Jira](jira.md) | branch `integracoes/jira` |
| [Anthropic](anthropic.md) | já na `main` |
| [Aviso de RH](rh.md) | #11 |
| [Agenda](agenda-google.md) e [CI/CD](cicd.md) | #15 |
| Diagnóstico e simulador | #24 |

Antes dos merges, use a branch `integracoes/diagnostico`, que tem a pilha inteira.

## Por onde começar

1. `pnpm integracoes:diagnostico` (#24): lista, por integração, o que já está configurado e o que falta, com o guia de cada item. Rode de novo depois de cada conta criada.
2. `pnpm integracoes:simular` (#24): com a API e o worker no ar, manda avisos assinados como se viessem do GitHub, do Linear, do Slack e da Vercel, e confere que o Echo grava, processa e não duplica. Se a simulação passa e a plataforma real não, o problema está na configuração da plataforma (URL, segredo ou eventos), não no Echo. Depois, `pnpm integracoes:simular --limpar`.

## Comandos comuns

```bash
pnpm integracoes:diagnostico  # o que falta configurar, item por item
pnpm integracoes:simular      # avisos assinados de teste contra a API local, sem plataforma real
pnpm integracoes:conferir     # confere Slack, GitHub e Linear e mostra os ids do .env
pnpm integracoes:ligar        # cria ou atualiza a empresa de teste, as pessoas, as contas e as rotas, e importa tarefas e PRs
pnpm integracoes:reconciliar  # roda uma rodada de reconciliação e de agenda na hora
pnpm integracoes:agenda <e-mail>   # mostra só o que o Echo lê da agenda de uma pessoa
pnpm integracoes:rh           # gera o segredo do aviso de RH; com --enviar, simula o sistema de RH
pnpm acao:testar --tarefa ECH-1 --para "Carla" --aprovador "Marina" [--canal C…] [--pr org/repo#1]
```

## A empresa de teste

`pnpm integracoes:ligar` lê do `.env`:

```bash
DEMO_ORG_NAME=Empresa de teste (integrações)
DEMO_SLACK_TEAM_ID=T…            # Slack: pnpm integracoes:conferir
DEMO_GITHUB_INSTALLATION_ID=…    # GitHub App: pnpm integracoes:conferir
DEMO_LINEAR_ORG_ID=…             # Linear: pnpm integracoes:conferir
DEMO_JIRA_SITE=…                 # Jira, no lugar do Linear (ex.: acme.atlassian.net)
DEMO_GOOGLE_DOMAIN=…             # Google Workspace (opcional)
DEMO_MICROSOFT_TENANT_ID=…       # Microsoft 365 (opcional)
DEMO_VERCEL_TEAM_ID=…            # Vercel (opcional)
# Pessoas e as contas de cada uma. Só as contas listadas são ligadas: o Echo nunca adivinha quem é quem.
DEMO_IDENTITIES='[{"nome":"Marina","papel":"leader","slack":"U01","linear":"uuid"},{"nome":"Bruno","slack":"U02","github":"bruno-teste","linear":"uuid","rh":"123","google":"bruno@empresa.com"}]'
```

Campos de cada pessoa: `nome`, `papel` (`member`, `leader` ou `hr`), `fuso` (IANA), `slack`, `github` (login), `linear` (id do usuário), `jira` (accountId), `rh` (matrícula), `google` e `microsoft` (e-mail).

## Para consultar o banco

```bash
docker compose exec db psql -U echo -d echo
```

As tabelas citadas nos guias: `inbox_events` (avisos recebidos), `work_events`, `tasks`, `pull_requests`, `contributions`, `questions`, `outbox_actions`, `absences`, `deployments`, `agent_runs` e `audit_log`.
