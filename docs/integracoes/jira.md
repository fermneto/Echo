# Jira Cloud

Tracker de tarefas (etapa 21) para empresas que usam Jira, sozinho ou junto com o Linear. A tarefa do Jira vira a mesma tarefa do Echo: redistribuição, relatório, "já terminou?" e plano da manhã funcionam igual. Com os dois ligados, cada tarefa guarda de onde veio (`tasks.source`), e a mudança de responsável e o comentário aprovados vão para o tracker dela. A chave da tarefa (`PAG-12`) é única na empresa, então **o Linear e o Jira precisam de prefixos de projeto diferentes**: uma tarefa do Jira com uma chave que já é do Linear (ou o contrário) não é importada, e o motivo aparece em `pnpm integracoes:ligar` e no diagnóstico.

## O que o Echo faz

- **Recebe** criação, mudança e remoção de issues por webhook assinado (`X-Hub-Signature: sha256=…`). A entrega repetida é barrada pelo `X-Atlassian-Webhook-Identifier`, que o Jira mantém igual nas novas tentativas. O espelho em `tasks` não volta atrás com um aviso atrasado, e a conclusão vira `task_done` uma vez.
- **Mapeia o workflow pela categoria do estado**, que é fixa em todo Jira: *To Do* → a fazer (ou backlog, se o nome for "Backlog"), *In Progress* → em andamento (ou em revisão, se o nome tiver "review"/"revisão"), *Done* → concluída (ou cancelada, se o nome for "Won't Do", "Cancelado", "Duplicado"…).
- **Story points** viram tamanho; **etiquetas e componentes** viram área.
- **Lê ao vivo:** tarefa (para "já terminou?"), abertas e encerradas em 7 dias, pela `POST /rest/api/3/search/jql` (a `/rest/api/3/search` antiga foi removida do Jira Cloud). Até 10 páginas de 50, com aviso quando há mais.
- **Reconcilia** a cada 10 minutos, junto com GitHub e agenda.
- **Escreve só pelo outbox, com aprovação:** responsável (só para quem tem conta no Jira) e comentário.
- A ligação entre tarefa e PR é a mesma do Linear: a chave no nome da branch ou no título (`pag-12-conciliacao` → `PAG-12`).

## Criar o site e a credencial

1. Crie um site de teste do **Jira Cloud** (plano gratuito: até 10 usuários) e um projeto (ex.: chave `ECH`). Convide as pessoas de teste.
2. Crie uma **conta para o Echo** (ou use a sua, só em teste) e um **token de API** em [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) → *Criar token de API*. O e-mail vai para `JIRA_EMAIL`, e o token vai para `JIRA_API_TOKEN`. A conta precisa poder ver os projetos, atribuir issues e comentar.
3. Crie o **webhook** em **Configurações → Sistema → WebHooks** (precisa ser administrador do site): URL `https://<API>/webhooks/jira`, eventos **Issue: created, updated, deleted**, e um **Secret** gerado com `openssl rand -hex 20`, que vai para `JIRA_WEBHOOK_SECRET`. Se o seu site não mostrar o campo Secret, registre o webhook pela API REST (`POST /rest/webhooks/1.0/webhook`, com o campo `secret`): sem segredo, o Echo recusa o aviso (401).
4. Crie as tarefas sintéticas da história (ex.: `ECH-1 Tempo limite nos pagamentos`, uma delas sem responsável).

## Variáveis

| Variável | Serviço | Onde pegar |
|---|---|---|
| `JIRA_WEBHOOK_SECRET` | api | o webhook (passo 3) |
| `JIRA_BASE_URL` | worker | o endereço do site, ex.: `https://acme.atlassian.net` |
| `JIRA_EMAIL`, `JIRA_API_TOKEN` | worker | o passo 2 |
| `JIRA_STORY_POINTS_FIELD` | worker, opcional | padrão `customfield_10016` ("Story point estimate"). Em projetos clássicos pode ser outro: veja o id em *Configurações → Issues → Campos personalizados* |
| `JIRA_JQL` | worker, opcional | filtro dos projetos importados, ex.: `project in (ECH, PAG)` |
| `DEMO_JIRA_SITE` | `.env` | o site em minúsculas, ex.: `acme.atlassian.net` |

Em `DEMO_IDENTITIES`, cada pessoa ganha `"jira": "<accountId>"`. O accountId aparece no fim do endereço do perfil da pessoa no Jira (`…/jira/people/<accountId>`).

## Conferir

```bash
pnpm integracoes:diagnostico   # "Jira · credencial aceita · N tarefas abertas" e a rota do site
pnpm integracoes:ligar         # liga o site à empresa e importa as tarefas abertas
```

## Validar

1. **Jira → Echo:** mude o estado de uma issue. Em segundos, `select key, state, assignee_id is not null from tasks order by updated_at desc limit 3;` mostra a mudança. No log do worker, `"flow":"inbox" … "result":"ok"`.
2. **Conclusão:** leve uma issue para *Done*. Aparece um `task_done` em `work_events`, com `source = jira`, e só um, mesmo com o reenvio do Jira.
3. **Ação aprovada:** registre uma ausência em Gestão → Redistribuição e aprove o plano. A issue muda de responsável no Jira, com o comentário do Echo.
4. **Reconciliação:** com a API parada, conclua uma issue; suba a API e rode `pnpm integracoes:reconciliar`. A tarefa aparece concluída.
5. **Assinatura:** um aviso com segredo errado recebe 401.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `/webhooks/jira` responde 503 | `JIRA_WEBHOOK_SECRET` ausente no `.env` da API |
| 401 em todo aviso | Segredo diferente do cadastrado no webhook, ou webhook sem segredo |
| Aviso chega mas nada muda | Site não ligado: confira `DEMO_JIRA_SITE` e rode `pnpm integracoes:ligar` |
| `Jira 401` no diagnóstico | E-mail e token não combinam, ou o token foi revogado |
| `Jira 410` | Alguma chamada à busca antiga; esta versão usa só `/search/jql` |
| Diagnóstico avisa "prefixos diferentes do Linear" | O Linear e o Jira têm projetos com o mesmo prefixo (ex.: `ECH` nos dois). As tarefas do Jira com uma chave que já é do Linear não entram no Echo. Use outro prefixo no projeto do Jira ou limite os projetos importados com `JIRA_JQL` |
| `pessoa sem conta no Jira` | Faltou `"jira"` dessa pessoa em `DEMO_IDENTITIES` |
| Tamanho vazio nas tarefas | O campo de story points do site não é o `customfield_10016`: ajuste `JIRA_STORY_POINTS_FIELD` |
