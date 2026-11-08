# Jira Cloud

Alternativa ao Linear (etapa 21) para empresas que usam Jira. A tarefa do Jira vira a mesma tarefa do Echo: redistribuição, relatório, "já terminou?" e plano da manhã funcionam igual. Uma empresa usa um tracker por vez: com o Linear também configurado, vale o Linear, e o Jira fica de fora (sem rota, importação, reconciliação ou escrita), para as tarefas dos dois não se sobrescreverem. A regra é uma só, `activeTracker` em `packages/connectors/src/platforms.ts`, usada pelas plataformas do worker, por `integracoes:ligar` (que tira a rota antiga do Jira), por `integracoes:simular` e pelo diagnóstico.

## Um tracker por vez

- **Webhook:** com o Linear ativo na empresa (a API não tem as credenciais do Linear e olha a rota: com a do Linear, vale o Linear), o aviso do Jira responde **200 com o corpo `ignored: linear ativo`**, vai para o log da API como `aviso recusado` e **não entra no inbox**. Sem rota do Jira (por exemplo, depois de `integracoes:ligar` com o Linear ligado), a resposta é `ignored: sem rota`, também registrada. É 200 e não 409 porque o Jira repete as entregas que recebem 408, 409, 425, 429 ou 5xx.
- **Worker:** com o Linear configurado, um aviso do Jira que já esteja no inbox (rota gravada antes da regra) fica como `ignored` e não mexe em `tasks`.
- **Tarefas antigas (limitação):** a tabela `tasks` não tem coluna de origem. Ao trocar de tracker, as tarefas do anterior **ficam abertas** no Echo, sem atualização nem reconciliação. A chave (`PROJ-123`) é igual nos dois; o que diferencia a tarefa do Jira é o id em `tasks.linear_id`, que é só número (ex.: `10042`), enquanto o do Linear é UUID. Com isso, o executor recusa a escrita na tarefa do outro tracker ("tarefa PAG-7 é do Jira, e o tracker ligado é o Linear"), em vez de mandar ao Linear o id do Jira. A migração com a origem está em [`pendencias.md`](../pendencias.md) (B17); até lá, apague as tarefas antigas da empresa à mão depois da troca.

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
| Aviso chega mas nada muda | Site não ligado: confira `DEMO_JIRA_SITE` e rode `pnpm integracoes:ligar`. A resposta do webhook diz `ignored: sem rota` |
| Webhook responde `ignored: linear ativo` | A empresa tem a rota do Linear: vale o Linear, e o aviso do Jira é recusado de propósito |
| Ação falha com "tarefa … é do Jira, e o tracker ligado é o Linear" | Tarefa que ficou do tracker anterior depois da troca (B17 em `pendencias.md`) |
| `Jira 401` no diagnóstico | E-mail e token não combinam, ou o token foi revogado |
| `Jira 410` | Alguma chamada à busca antiga; esta versão usa só `/search/jql` |
| Diagnóstico diz "Jira desligado nesta empresa" | O Linear também está configurado. Vale um tracker por vez: com os dois, vale o Linear, e o Jira fica sem rota, importação e reconciliação. Para usar o Jira, tire as variáveis `LINEAR_*` |
| `pessoa sem conta no Jira` | Faltou `"jira"` dessa pessoa em `DEMO_IDENTITIES` |
| Tamanho vazio nas tarefas | O campo de story points do site não é o `customfield_10016`: ajuste `JIRA_STORY_POINTS_FIELD` |
