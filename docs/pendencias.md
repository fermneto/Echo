# Pendências: bloqueios, configuração e validação

Situação em **8/11/2026**, com a `main` no merge do #78. Aqui fica o que impede avançar, o que falta configurar e o que testar para dar o Echo como funcionando. O guia de cada integração (conta, variáveis, conferência e validação) está em [`integracoes/`](integracoes/README.md). Quem cuida de cada parte está em [`equipe.md`](equipe.md).

**Prazo:** entrega no domingo, 8/11, às 13h. Demo Day às 16h.

## 1. Onde estamos

**Na `main`** (último merge: #78, que conserta o teste das ações sem executor; antes dele, o #77, conector do Jira Cloud):

| Etapa | O quê | Frente |
|---|---|---|
| 1 | Base, CI e deploy pela Render via Actions (#39) | Avaliador |
| 2 | Esquema, seed, isolamento com RLS e `withOrg`; escopo `"none"` como padrão de `createPool` (#50) | Funções |
| 3 | Webhooks, adaptadores, reconciliação e executor do outbox; ação que falhou por falta de executor volta para a fila (#67) | Integrações |
| — | Fila: a agenda não repete jobs, com a janela do pg-boss em todos os envios (`DEDUPE_SECONDS`, #74) | Avaliador |
| 4 a 6 | Regras fixas, cérebro, resposta com validador, resposta por regra, idioma da conversa e roteador de custo da resposta (#50) | Funções |
| 7 a 9 | Quem sabe, nota do dia, revisão noturna com triagem por modelo aberto (#46) e plano da manhã (um por pessoa e dia, #69) | Funções |
| 10 | Correção no Managed Agents, rodando no worker, com Aplicar e Recusar no privado do Slack (#61); diff conferido é o diff aplicado, branch do rascunho travada e aprovação no `audit_log` (#65); clique repetido numa correção já decidida não confunde (#70) | Funções e Avaliador |
| 10 | "Seu agente": estilo e delegação escritos pela pessoa, com o juiz pequeno (#50) | Funções |
| 11 a 13 | Redistribuição (trocar quem recebe e passar adiante, #51; liderança sem equipe aprova, #72), relatório e ganhos | Funções |
| 14 | Espelho das notas no repositório `brains` (#29) | Integrações |
| 15 | Aviso de RH assinado, login no painel com o Slack (#53, #55) e cadastro pelo RH com foto e currículo, que vira o bonequinho em pixel art (#54, #59, #63, #66) | Integrações e Web |
| 16 | Painel com dados reais, roteiro da demo, custo e execuções (#32, #34, #45, #47); telas com dados reais para quem é de empresa conectada (#73); worker grava em `agent_runs` (#68); história da demo no navegador com Playwright, na CI (`pnpm e2e`, #75) | Web e Avaliador |
| 18 e 19 | Agenda (Google e Microsoft 365) e CI/CD (GitHub Actions e Vercel) | Integrações |
| 21 | Jira Cloud no lugar do Linear (#77): webhook assinado, reconciliação e leitura ao vivo; responsável e comentário pelas mesmas ações `linear.assign` e `linear.comment`, com aprovação. Token de API de conta de serviço (`JIRA_*`) em vez do OAuth `ATLASSIAN_*`. Asana, GitHub Issues e GitLab ficam fora | Integrações |
| 26 | Resumo do dia montado por modelo aberto (#48, #49), que chega como imagem no privado do Slack (#52, #56, #57) | Funções e Web |

**Comandos para ensaiar os fluxos na hora:** `pnpm nota:agora` (#52), `pnpm noite:agora` (#60) e `pnpm manha:agora` (#69) põem o job na fila, e o worker faz o resto. `pnpm relatorio:agora` (#75) gera na hora o relatório da semana que já fechou, sem duplicar e sem enviar ao RH.

**Fora do escopo da demo (próximos passos no pitch):** etapas 17 (camada de conexões), 20 (incidentes e plantão), 21 (Asana, GitHub Issues e GitLab; o Jira entrou no #77), 22 (chat alternativo), 23 (base de conhecimento), 24 (RH e diretório), 25 (API pública) e a parte da etapa 27 que ainda falta (vídeo por entrega no relatório individual, ver B16). O vídeo da semana da equipe já está na `main` (#82).

## 2. Bloqueios e decisões em aberto

### B1. Testes contra as plataformas de verdade

**Dono:** Integrações.
**Situação:** a empresa de teste das integrações existe (#43), mas a seção 4.2 ainda não foi marcada como verificada.
**Destrava:** rodar os testes A a L e marcar o resultado aqui.

### B7. Hospedagem na Render

**Dono:** Avaliador.
**Situação:** banco, API e painel no plano gratuito; worker e triagem (`echo-triage`) são pagos. Desde o #61, a correção roda no `echo-worker`, e o `echo-reviewer` ficou comentado no Blueprint. Falta conferir se `FIX_AGENT_ID` e `FIX_ENVIRONMENT_ID` estão no `echo-worker`. O painel (`echo-web`) também pede `GITHUB_APP_ID` e `GITHUB_PRIVATE_KEY`, para conferir o rascunho da correção em Meu plano.
**Destrava:** rodar `pnpm --filter @echo/reviewer provision` uma vez e copiar os dois ids para o `echo-worker`.

### B13. Escopo de equipe no painel com banco

**Dono:** Web.
**Situação:** "Pergunte ao Echo" (Início), com banco ligado, manda ao agente só a empresa e quem pergunta (`panelRequest` em `apps/web/lib/agent.ts`), não o recorte da tela. O agente limita a lista e a carga da equipe à equipe de quem pergunta (`packages/agents/src/tools.ts`), como no Slack. Ficam de fora:
- as equipes que o RH escolheu acompanhar no painel: para o RH, o agente não tem equipe e lista a empresa toda;
- tarefas e PRs, que o agente busca na empresa toda, também como no Slack.

Só "quem está no expediente" sai pela equipe da tela.

### B14. Páginas sem tratamento de erro do banco

**Dono:** Web.
**Situação:** sem `DATABASE_URL`, `/redistribuicao`, `/execucoes` e `/resumos` mostram os dados da demo. Com `DATABASE_URL` e o banco fora do ar, as três dão erro 500: a leitura do banco não tem `try/catch` e o painel não tem `error.tsx`. O Início não cai, porque `loadTeam` volta para a equipe da demo.

### B15. Webhook do Jira: repetição e endereço do site

**Dono:** Integrações.
**Situação:** duas sugestões da revisão do #77, sem bloquear a demo:
- recusar o aviso com `body.timestamp` fora de cerca de 5 minutos, contra repetição. Hoje o `verifyJira` só confere a assinatura, e a entrega repetida é barrada pelo `X-Atlassian-Webhook-Identifier`;
- restringir `JIRA_BASE_URL` a `https://*.atlassian.net`. Hoje `packages/config` só exige uma URL válida.

### B17. Tarefas do tracker antigo ao trocar de Linear para Jira (ou o contrário)

**Dono:** Integrações.
**Situação:** vale um tracker por vez (`activeTracker` em `packages/connectors/src/platforms.ts`; com o Linear configurado, o Jira fica de fora). A tabela `tasks` não guarda a origem, então, ao trocar de tracker, as tarefas antigas **ficam abertas** no Echo: ninguém mais as atualiza nem as reconcilia, e elas continuam contando na carga, na redistribuição e no plano da manhã. A chave (`PROJ-123`) é igual nos dois trackers e não serve para separar; o que separa é o id em `tasks.linear_id`: no Jira é só número (ex.: `10042`), no Linear é UUID. Por isso a escrita já recusa a tarefa do outro tracker: `linear.assign` e `linear.comment` falham com "tarefa PAG-7 é do Jira, e o tracker ligado é o Linear" em vez de mandar ao Linear o id do Jira (`trackerOfTaskId`, no executor de `packages/actions`).
**Destrava:** uma migração com a coluna de origem em `tasks` (`linear` ou `jira`), preenchida pela regra do id, e o fechamento (ou arquivamento) das tarefas do tracker que saiu. Até lá, quem troca de tracker apaga as tarefas antigas da empresa à mão.

### Resolvidos

- **B2, B3, B9:** entraram com o #23.
- **B4** (dois consumidores da fila de cliques) e **B10** (ações sem aprovação paradas no outbox): resolvidos no merge da Frente 2 (#30 e o roteador único em `slack-interactions.ts`).
- **B5** (numeração das migrações): a `0012_estilo_delegacao` entrou com o #50.
- **B6** (avaliação com o modelo real): `pnpm evals` com o Claude Sonnet 5.5 deu **15 de 15**, sem falha de segurança (7/11, cerca de US$ 0,17).
- **B8** (permissões da sessão): não se aplica mais.
- **B12** (`pnpm e2e`): a história da demo roda no navegador com Playwright, sem modelo, e entrou na CI (#75).
- **B11** (regra 1 com a delegação escrita): decidida em 8/11 pelo dono do projeto. A delegação escrita pela pessoa conta como aprovação registrada feita antes por ela, só para o que ela cobre; o juiz pequeno confere, e na dúvida ou em falha a correção espera a pessoa. Está no `CLAUDE.md`.
- **Correção sem GitHub e escopo `"none"`:** resolvidos no #50.
- **Redirecionamento aberto na volta do login:** a volta recusa caractere de controle (#55).
- **DM duplicado do resumo do dia:** a imagem e a reserva usam a mesma chave, um DM por dia (#57).
- **Revisão noturna que caía por erro de um PR:** a falha de um PR não derruba as outras (#64).
- **Trava da demo no cadastro e na edição de perfil:** com limite do cadastro (#54, #59).
- **Worker sem linha em `agent_runs`:** ingestão, outbox, espelho e reconciliação gravam (#68).
- **Vários jobs da noite no mesmo dia:** um só job da revisão noturna por empresa no dia (#71). A agenda também não repete jobs nas outras filas: todo envio usa a janela do pg-boss (`DEDUPE_SECONDS`, #74).
- **Telas com dados reais e recorte de equipe (#73):** quem entra pelo Slack vê a equipe, a ficha, as pendências e o plano lidos do banco. Se a leitura das equipes falha, `loadTeams` devolve `null` e o recorte fica só com a própria pessoa, em vez de abrir a empresa toda.
- **Diff da correção, branch do rascunho e auditoria:** o diff conferido é o aplicado, a branch do rascunho fica travada e a aprovação vai ao `audit_log`, inclusive pela delegação, com a origem `delegacao` (#65).

### B16. Vídeo por entrega no relatório individual

**Dono:** Funções.
**Situação:** a etapa 27 entrou como vídeo da semana da equipe (#82): sai depois da liberação dos relatórios ao RH, mostra só totais, entregas sem autor e ajudas, e a equipe e a liderança veem no painel com link assinado. O que o manual descreve para o relatório de cada pessoa continua por fazer: até 3 vídeos por entrega com tela, ao lado da entrega no relatório individual, que a pessoa assiste e aprova, descarta ou pede de novo antes do envio ao RH (vídeo descartado não vai ao RH; o prazo de 3 dias não muda).
**Destrava:** reaproveitar o roteiro e a gravação do vídeo da equipe (`packages/agents/src/video.ts`), com um estado de aprovação por vídeo e o filtro no envio ao RH.

## 3. O que configurar

### Contas (uma vez)

| Plataforma | O que criar | Guia |
|---|---|---|
| Slack | Espaço de teste e app pelo manifesto `infra/slack-manifest.yml` | teste-integracoes, passo 2 |
| GitHub | Organização de teste, repositório público `app` e GitHub App instalado nele (Contents e Pull requests em *Read and write*) | passo 2 |
| Linear | Espaço de teste e chave pessoal ou app OAuth, mais o webhook de Issues | passo 2 |
| Jira Cloud (no lugar do Linear) | Site e projeto de teste, conta de serviço com token de API e webhook com segredo | `integracoes/jira.md` |
| Anthropic | Organização, limite de gasto e chave de API | etapa 6 do manual |
| Managed Agents | Agente e ambiente da correção: `pnpm --filter @echo/reviewer provision` | etapa 10 |
| Render | Blueprint a partir de `infra/render.yaml` | B7 |
| Google Workspace ou Microsoft 365 | Conta de serviço com delegação, ou app no Entra com consentimento do administrador | teste I |
| Vercel | Projeto do repositório de teste e webhook de deploys | teste J |
| Langfuse (opcional) | Projeto, com chave pública e secreta | etapa 1 do manual |

### Variáveis por serviço

Toda variável é validada em `packages/config`, e o serviço falha cedo, com mensagem clara, se ela estiver errada. O `echo-reviewer` está fora do Blueprint até ter trabalho próprio (os vídeos); a correção roda no worker.

| Variável | api | web | worker | Origem |
|---|:-:|:-:|:-:|---|
| `DATABASE_URL` | ✔ | ✔ | ✔ | Render (banco) ou `docker compose` local |
| `ENCRYPTION_KEY` | ✔ | | ✔ | `openssl rand -hex 32`, a mesma nos serviços. Trocar invalida as credenciais guardadas |
| `GITHUB_WEBHOOK_SECRET` | ✔ | | | GitHub App → Webhook secret |
| `SLACK_SIGNING_SECRET` | ✔ | | | App do Slack → Basic Information |
| `LINEAR_WEBHOOK_SECRET` | ✔ | | | Webhook do Linear |
| `JIRA_WEBHOOK_SECRET` | ✔ | | | Webhook do Jira Cloud |
| `VERCEL_WEBHOOK_SECRET` | ✔ | | | Webhook de deploys da Vercel |
| `SLACK_BOT_TOKEN` | | | ✔ | App do Slack → Bot User OAuth Token (`xoxb-…`) |
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` | | ✔ | ✔ | GitHub App (chave `.pem` numa linha, com `\n`) |
| `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` ou `LINEAR_API_KEY` | | | ✔ | App OAuth do Linear, ou chave pessoal para testes |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` (e, opcionais, `JIRA_STORY_POINTS_FIELD` e `JIRA_JQL`) | | | ✔ | Site do Jira e token de API de uma conta de serviço. Com o Linear ligado, vale o Linear |
| `ANTHROPIC_API_KEY` | | ✔ | ✔ | Anthropic. Sem ela, o agente responde só por regra e não há correção |
| `SLM_OLLAMA_URL`, `SLM_MODEL`, `TRIAGE_TIMEOUT_MS` | | ✔ | ✔ | `echo-triage` (Qwen3 4B). No worker: triagem, resumo do dia e juiz da delegação. No painel: currículo do cadastro. `TRIAGE_TIMEOUT_MS` só no worker |
| `FIX_AGENT_ID`, `FIX_ENVIRONMENT_ID` | | | ✔ | `pnpm --filter @echo/reviewer provision` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` | | | ✔ | Conta de serviço do Google, com delegação no domínio |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | | | ✔ | App multi-tenant no Microsoft Entra |
| `BRAINS_REPOSITORY`, `RECONCILE_INTERVAL_MS` | | | ✔ | Repositório do espelho das notas; intervalo da reconciliação (padrão: 10 min) |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | | ✔ | | App do Slack → Basic Information (login no painel) |
| `SESSION_SECRET` | | ✔ | | Gerado pelo Blueprint; local: `openssl rand -hex 32` |
| `PANEL_URL` | | ✔ | | Endereço público do painel |
| `DEMO_MODE` | ✔ | ✔ | ✔ | `true` no evento: login por usuário e senha (`echo` para todos) e simulador |
| `LANGFUSE_*` | opcional | opcional | opcional | Langfuse |

**Para ligar a empresa de teste** (`pnpm integracoes:ligar`): `DEMO_ORG_NAME`, `DEMO_SLACK_TEAM_ID`, `DEMO_GITHUB_INSTALLATION_ID`, `DEMO_LINEAR_ORG_ID`, `DEMO_JIRA_SITE`, `DEMO_GOOGLE_DOMAIN`, `DEMO_MICROSOFT_TENANT_ID`, `DEMO_VERCEL_TEAM_ID` e `DEMO_IDENTITIES`, que lista as pessoas e as contas de cada uma. `pnpm integracoes:conferir` mostra os ids que vão nessas variáveis.

**Para o aviso de RH:** `pnpm integracoes:rh` gera o segredo da empresa e mostra a URL a configurar no sistema de RH.

## 4. O que testar para validar

Na ordem. Cada etapa só faz sentido com a anterior verde.

### 4.1 Sem plataformas

- [x] `pnpm typecheck && pnpm test` com o banco migrado: 16 de 16 pacotes (7/11, no ramo do #50). Os testes de banco rodam com um papel comum do Postgres, então o RLS vale de verdade.
- [x] `pnpm evals` com o modelo real: 18 de 18 (15 fixos e 3 de idioma), sem falha de segurança (7/11).
- [ ] CI verde na `main` depois do último merge (#78), já com o `pnpm e2e`. O CI da `main` tinha falhado no merge do #75 por esse teste, e o deploy foi pulado.

### 4.2 Com as plataformas de teste (guias em [`integracoes/`](integracoes/README.md))

| Teste | O que prova | Precisa de |
|---|---|---|
| A | Linear → Echo | Linear |
| B | GitHub → Echo, sem duplicar | GitHub App |
| C | Slack → Echo; conversa comum descartada; reação 🙏 vira ajuda | App do Slack |
| D | Ação aprovada muda o Linear e comenta no Slack e no GitHub | Os três |
| E | Reenvio não duplica; assinatura errada → 401 | Qualquer um |
| F | Aviso perdido recuperado pela reconciliação | GitHub e Linear |
| G | Aviso de RH registra férias sem o motivo | `ENCRYPTION_KEY` |
| H | Login no painel com o Slack; desligado não entra | App do Slack (OAuth) |
| I | "Fora do escritório" vira ausência; férias viram sugestão | Google ou Microsoft |
| J | Checks e deploys; "passou?" e "está em produção?" | GitHub Actions e Vercel |
| K | Resposta no Slack como "Agente de Fernando", com fonte e volta prevista | Slack e Anthropic |
| L | Erro plantado num PR → correção em rascunho → aprovada em Meu plano (ou pela delegação) → unida no PR | GitHub App, Anthropic, Managed Agents e os ids da correção no worker |

### 4.3 Os 8 testes de "funcionando de verdade" (manual, etapa 16)

| # | Teste | Coberto por | Situação |
|---|---|---|---|
| 1 | Um push real no GitHub atualiza o registro | Teste B | construído; falta o teste real (B1) |
| 2 | Com a pessoa ausente pelo fuso, uma pergunta real no Slack recebe resposta correta, com fonte | Teste K | construído; falta o teste real (B1) |
| 3 | Um PR real recebe análise e correção preparada, e o plano da manhã mostra isso | Etapas 9 e 10, teste L | construído e testado com GitHub simulado; faltam os ids da correção no `echo-worker` (B7) |
| 4 | Uma ausência no painel gera um plano e, com a aprovação do líder, altera tarefas reais | Teste D + etapa 11 | construído; falta o teste real (B1) |
| 5 | Uma pessoa com poucos commits aparece no relatório com as ajudas | Etapa 12 | construído |
| 6 | Uma tentativa de injeção em comentário de PR não muda o comportamento | `pnpm evals` + teste K | passa com o modelo real |
| 7 | O painel mostra custo e rastro de cada execução | Custo e execuções | construído |
| 8 | Com os computadores de quem desenvolve desligados, tudo continua funcionando | Render | B7 |

### 4.4 Roteiro da demo (manual, aba Demo)

As cinco cenas, em 3 minutos: a pergunta que esperaria um dia, a manhã de Fernando, as férias de Bruno, o trabalho invisível, e custo, rastro e ganhos. Ensaie com o cronômetro depois que a seção 4.3 estiver verde. Os dados são sintéticos, e o seed recria a demonstração (`pnpm db:seed`).

## 5. O que falta por Frente

| Item | Frente |
|---|---|
| Testes A a L contra as plataformas de verdade (B1) | Integrações |
| Webhook do Jira: recusar `body.timestamp` fora de cerca de 5 minutos e restringir `JIRA_BASE_URL` a `https://*.atlassian.net` (B15) | Integrações |
| Revisão visual do card "Seu agente" (`/pessoas/[id]`) e dos botões Aprovar e Recusar da correção em Meu plano, que usam os componentes que já existiam, sem revisão de design. Os arquivos são `apps/web/components/AgentProfileForm.tsx`, `apps/web/app/(painel)/plano/PlanList.tsx` e o bloco "Seu agente" em `apps/web/app/painel.css` | Web (Frente 3) |
| Ids da correção no `echo-worker` (B7), vídeo, README e lista de ferramentas | Avaliador |
| Equipes escolhidas pelo RH no "Pergunte ao Echo" com banco (B13) | Web (Frente 3) |
| Tratamento de erro do banco em `/redistribuicao`, `/execucoes` e `/resumos` (B14) | Web (Frente 3) |
| ~~Juiz da delegação com o Qwen3 de verdade~~: feito em 7/11, 6 de 6 com o Qwen3 4B Instruct local (10 a 30 s por decisão em CPU), inclusive recusando o texto que manda responder cabe=true | Funções |
| SSLM do roteador: o Qwen3 0.6B e o 4B não passaram na checagem (ver engenharia, "Por que o SSLM ficou desligado"); fica só a regra. Testar outro modelo pequeno só se passar na mesma checagem | Funções |
| Reconstruir o echo-triage na Render quando der: a imagem agora tenta de novo o download do modelo (antes, uma queda de rede perdia o build inteiro) | Avaliador |
| Site e painel em inglês: hoje só existe a versão em português (`<html lang="pt-BR">` fixo, sem rotas `/en`). O agente já responde em português, inglês e espanhol; faltam os textos do site, do painel e das mensagens privadas do Echo | Web (Frente 3) |
