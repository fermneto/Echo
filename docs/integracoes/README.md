# Integrações: configuração e validação

Um guia por plataforma. Todos seguem a mesma estrutura: o que o Echo faz com ela, de quais PRs depende, como criar a conta, as variáveis, como conferir as credenciais, como validar (com o resultado esperado) e os problemas comuns.

Use **só espaços de teste e dados sintéticos**. A situação geral e os bloqueios estão em [`../pendencias.md`](../pendencias.md).

## Ordem sugerida

| # | Guia | Por que nesta ordem | Depende dos PRs |
|---|---|---|---|
| 0 | [Ambiente local e túnel](ambiente.md) | Base de todos os testes | `main` |
| 1 | [Slack](slack.md) | Canal da pergunta e da resposta, e login no painel | #3, #11, #19 |
| 2 | [GitHub](github.md) | Commits, PRs, revisões e checks | #5, #7, #8 |
| 3 | [Linear](linear.md) | Tarefas e mudança de responsável aprovada | #5, #7, #8 |
| 4 | [Anthropic](anthropic.md) | Resposta do agente com o modelo | #16 |
| 5 | [Aviso de RH](rh.md) | Férias e afastamentos assinados | #11 |
| 6 | [Agenda: Google Workspace](agenda-google.md) | "Fora do escritório" e férias detectadas | #15 |
| 7 | [Agenda: Microsoft 365](agenda-microsoft.md) | Idem, mais o expediente da caixa | #15 |
| 8 | [CI/CD: GitHub Actions e Vercel](cicd.md) | "Os testes passaram?" e "já está em produção?" | #15 |
| 9 | [Render (hospedagem)](render.md) | Tudo no ar, sem o computador de ninguém | todos |

Sem os PRs da coluna "depende", os comandos citados no guia ainda não existem na `main`. Para testar antes do merge, use a branch do último PR da pilha de Integrações (`integracoes/slack-resposta`).

## Comandos comuns

```bash
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
DEMO_GOOGLE_DOMAIN=…             # Google Workspace (opcional)
DEMO_MICROSOFT_TENANT_ID=…       # Microsoft 365 (opcional)
DEMO_VERCEL_TEAM_ID=…            # Vercel (opcional)
# Pessoas e as contas de cada uma. Só as contas listadas são ligadas: o Echo nunca adivinha quem é quem.
DEMO_IDENTITIES='[{"nome":"Marina","papel":"leader","slack":"U01","linear":"uuid"},{"nome":"Bruno","slack":"U02","github":"bruno-teste","linear":"uuid","rh":"123","google":"bruno@empresa.com"}]'
```

Campos de cada pessoa: `nome`, `papel` (`member`, `leader` ou `hr`), `fuso` (IANA), `slack`, `github` (login), `linear` (id do usuário), `rh` (matrícula), `google` e `microsoft` (e-mail).

## Para consultar o banco

```bash
docker compose exec db psql -U echo -d echo
```

As tabelas citadas nos guias: `inbox_events` (avisos recebidos), `work_events`, `tasks`, `pull_requests`, `contributions`, `questions`, `outbox_actions`, `absences`, `deployments`, `agent_runs` e `audit_log`.
