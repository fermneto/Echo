# GitHub

## O que o Echo faz

- **Recebe** push, PR (aberto, fechado e unido), revisão, comentário de revisão e o resultado dos checks (`check_suite`) por webhook assinado. Grava os fatos em `work_events`, o espelho em `pull_requests` e o crédito por coautoria e por revisão atendida em `contributions`.
- **Lê ao vivo**, pelo GitHub App: PR com arquivos (e o `mergeable`, que vem nulo enquanto o GitHub calcula), PR de uma branch, último commit, PRs abertos e checks de um commit.
- **Reconcilia** a cada 10 minutos: commits de 7 dias, PRs abertos, arquivos dos PRs que mudaram e o estado dos que saíram da lista. Também pede o reenvio das entregas que falharam.
- **Escreve só pelo outbox:** comentário de análise no PR (sem aprovação, e nunca aprovando o PR) e pedido de revisores (com aprovação).

**Nunca:** aprova PR, faz merge ou guarda logs da CI.

**PRs:** #5 (adaptador), #7 (escritas aprovadas), #8 (reconciliação), #15 (checks).

## Criar o app

1. Crie uma organização de teste (ex.: `<org>-teste`) com um repositório **público** `app`, só com dados sintéticos.
2. **Settings → Developer settings → GitHub Apps → New GitHub App:**
   - **Webhook URL:** `https://<API>/webhooks/github`.
   - **Webhook secret:** `openssl rand -hex 20`, que vai para `GITHUB_WEBHOOK_SECRET`.
   - **Permissões do repositório:** Contents e Pull requests em *Read and write*. Metadata, Checks e Issues em *Read*.
   - **Permissões da organização:** Members em *Read*.
   - **Eventos:** Push, Pull request, Pull request review, Pull request review comment, Issue comment, Check suite.
3. Anote o **App ID**. Gere uma **private key** e passe o `.pem` para uma linha só:
   ```bash
   awk 'NF {printf "%s\\n", $0}' chave.pem   # cole o resultado entre aspas em GITHUB_PRIVATE_KEY
   ```
4. **Install App** na organização de teste, só no repositório `app`.

## Variáveis

| Variável | Serviço | Onde pegar |
|---|---|---|
| `GITHUB_WEBHOOK_SECRET` | api | o segredo que você gerou |
| `GITHUB_APP_ID` | worker | página do app |
| `GITHUB_PRIVATE_KEY` | worker | a chave `.pem` em uma linha |
| `DEMO_GITHUB_INSTALLATION_ID` | `.env` | `pnpm integracoes:conferir` |
| `BRAINS_REPOSITORY` | worker | opcional: repositório do espelho das notas (push nele não é trabalho) |

## Conferir

```bash
pnpm --filter @echo/connectors github:check
# App ok: Echo teste (echo-teste)
#   instalação 55555555 em org-teste
# Instalação 55555555 (DEMO_GITHUB_INSTALLATION_ID) vê 1 repositórios: org-teste/app
```

No `DEMO_IDENTITIES`, use o **login** do GitHub de cada pessoa (`"github": "carla-teste"`). Depois rode `pnpm integracoes:ligar`, que também importa os PRs abertos.

## Validar

### G1. Push e PR viram fatos, sem duplicar

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

Esperado:
- um `commit` com `task_key = ECH-1` e `pessoa_ligada = t`, se o login do autor estiver em `DEMO_IDENTITIES`;
- um `pr_opened`;
- o PR em `pull_requests`.

Depois, no app, abra **Advanced → Recent Deliveries**, escolha uma entrega e clique em **Redeliver**. Rode as consultas de novo: nenhuma linha nova.

### G2. Crédito por coautoria e por revisão

1. Faça um commit com `Co-authored-by: Nome <id+login@users.noreply.github.com>` de outra pessoa cadastrada → `contributions` com `kind = coauthor`.
2. Peça a outra pessoa que revise o PR e faça um commit depois da revisão → `kind = review_change`.

### G3. Comentário pelo outbox (precisa do #7)

```bash
pnpm acao:testar --pr <org>-teste/app#1
```

Esperado: um comentário "Teste de integração do Echo… Isto não é uma aprovação." no PR, e `outbox_actions` com `state = done`.

### G4. Reconciliação (precisa do #8)

Pare a API. Una o PR e faça mais um commit em outra branch. Suba a API de novo e rode:

```bash
pnpm integracoes:reconciliar
# reconcile_redeliver  ok …
# reconcile_github     ok …
```

Esperado: o PR como `merged`, um `pr_merged` e o commit novo em `work_events`. Rodar de novo não duplica nada.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| 404 "Integration not found" | `GITHUB_APP_ID` errado, ou a chave é de outro app |
| 401 no webhook | `GITHUB_WEBHOOK_SECRET` diferente do configurado no app |
| O aviso chega, mas não grava | `DEMO_GITHUB_INSTALLATION_ID` não ligado: a instalação desconhecida é descartada |
| Commit sem pessoa | O login do autor não está em `DEMO_IDENTITIES`, ou o commit não está ligado a uma conta do GitHub (o Echo não adivinha pelo nome) |
| 403 ao comentar | O app não tem *Pull requests: Read and write*, ou não está instalado no repositório |
| "limite de taxa" | Muitas consultas ao vivo: a reconciliação já limita a 10 detalhes por repositório a cada rodada |
