# Linear

## O que o Echo faz

- **Recebe** criação, mudança e remoção de tarefas por webhook assinado (`Linear-Signature`, com janela de 60 s). O espelho em `tasks` não volta atrás com um aviso atrasado, e a conclusão vira `task_done` uma vez.
- **Lê ao vivo:** tarefa (para "já terminou?"), tarefas abertas e tarefas encerradas em 7 dias. Lê até 10 páginas de 50 e avisa quando há mais.
- **Reconcilia** a cada 10 minutos.
- **Escreve só pelo outbox, com aprovação:** mudança de responsável (só para quem tem conta no Linear) e comentário.

**PRs:** #5 (adaptador), #7 (escritas aprovadas), #8 (reconciliação).

## Criar o espaço e a credencial

1. Crie um espaço de teste (plano gratuito: até 250 tarefas e 2 times), com um time e etiquetas de área (ex.: `pagamentos`).
2. Crie a credencial. Há duas opções:
   - **Mais rápido:** chave pessoal em **Settings → Security & access → Personal API keys**, que vai para `LINEAR_API_KEY`.
   - **Como em produção:** app OAuth em **Settings → API → OAuth applications**, instalado como app (`actor=app`) por um administrador. Vai para `LINEAR_CLIENT_ID` e `LINEAR_CLIENT_SECRET`. O token do app é renovado sozinho.
3. Crie o **webhook** (no app OAuth, ou em **Settings → API → Webhooks**): URL `https://<API>/webhooks/linear`, recurso **Issues**. O segredo de assinatura vai para `LINEAR_WEBHOOK_SECRET`.
4. Crie as tarefas sintéticas da história (ex.: `ECH-1 Tempo limite nos pagamentos`, uma delas sem responsável).

## Variáveis

| Variável | Serviço | Onde pegar |
|---|---|---|
| `LINEAR_WEBHOOK_SECRET` | api | o webhook |
| `LINEAR_API_KEY`, ou `LINEAR_CLIENT_ID` e `LINEAR_CLIENT_SECRET` | worker | o passo 2 |
| `DEMO_LINEAR_ORG_ID` | `.env` | `pnpm integracoes:conferir` |

## Conferir

```bash
pnpm --filter @echo/connectors linear:check
# App ok. Organização (DEMO_LINEAR_ORG_ID): 0f0e… · Org teste
# 2 pessoas (ids para DEMO_IDENTITIES):
#   a1b2…  Marina
#   c3d4…  Carla
# 3 tarefas abertas:
#   ECH-1  todo  Tempo limite nos pagamentos
```

Coloque os ids no `DEMO_IDENTITIES` (`"linear": "a1b2…"`) e rode `pnpm integracoes:ligar`, que também importa as tarefas abertas.

## Validar

### L1. Mudança no Linear chega ao Echo

Mude o estado ou o título de uma tarefa no Linear.

```sql
select key, title, state, assignee_id is not null as tem_responsavel, external_updated_at from tasks order by updated_at desc limit 5;
```

O log do worker deve mostrar `"flow":"inbox" … "result":"ok"`. Ao concluir a tarefa, um `task_done` aparece em `work_events`, uma vez só.

### L2. Mudança de responsável aprovada (precisa do #7)

```bash
pnpm acao:testar --tarefa ECH-1 --para "Carla" --aprovador "Marina"
# 1. Ação no outbox, aguardando aprovação: mudar ECH-1 para Carla
# 2. Execução antes de aprovar: 0 feitas (esperado: 0)
# 3. Aprovada por Marina
# 4. Executadas: 2 · falharam: 0 · para tentar de novo: 0
```

Esperado no Linear: a ECH-1 com Carla como responsável e o comentário "Responsável alterado para Carla pelo Echo, com aprovação de Marina".

```sql
select type, target, state, attempts, error, approved_by is not null as aprovada from outbox_actions order by created_at desc limit 5;
select actor, action, target from audit_log order by created_at desc limit 5;
```

Caso que deve falhar com motivo, sem tocar no Linear: `--para` com uma pessoa sem `"linear"` em `DEMO_IDENTITIES` → "pessoa sem conta no Linear".

### L3. Reconciliação (precisa do #8)

Com a API parada, conclua uma tarefa no Linear. Depois suba a API e rode `pnpm integracoes:reconciliar` → a tarefa aparece como `done`, com um `task_done`, uma vez só.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| 401 "token recusado" | Credencial errada; com app OAuth, ele precisa estar instalado como app (`actor=app`) |
| 401 no webhook | `LINEAR_WEBHOOK_SECRET` diferente, ou o relógio fora da janela de 60 s |
| O aviso chega, mas não grava | `DEMO_LINEAR_ORG_ID` não ligado |
| "pessoa sem conta no Linear" | Faltou `"linear"` dessa pessoa em `DEMO_IDENTITIES`: a tarefa só vai para quem tem conta |
| "tarefa … sem id no Linear" | A tarefa não foi importada: rode `pnpm integracoes:ligar` de novo |
