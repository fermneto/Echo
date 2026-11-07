# Pendências: bloqueios, configuração e validação

Situação em **7/11/2026, 13h50**. Este documento diz o que impede avançar, o que falta configurar e o que testar para dar o Echo como funcionando. O guia de cada integração (conta, variáveis, conferência e validação) está em [`integracoes/`](integracoes/README.md).

## 1. Onde estamos

**Na `main`:**
- base e CI (etapa 1);
- esquema, seed e isolamento por empresa (etapa 2);
- webhooks (etapa 3, primeira parte);
- regras fixas (etapa 4);
- cérebro (etapa 5);
- fluxo de resposta, validador, resposta por regra e avaliação fixa (etapa 6, #1, #16 e #23);
- estrutura do painel com login por persona;
- este documento (#21).

**PRs abertos:**

| PR | Frente | O quê | Migração |
|---|---|---|---|
| #3 | Integrações | Adaptador do Slack | — |
| #5 | Integrações | Adaptadores do GitHub e do Linear | — |
| #7 | Integrações | Executor de ações aprovadas (outbox) e ferramentas de teste real | `0005_outbox_inicio` |
| #8 | Integrações | Reconciliação com GitHub e Linear | — |
| #11 | Integrações | Aviso de RH e login no painel com o Slack | `0006_ausencia_rh` |
| #14 | Integrações | `withOrg` e `asSystem` em todo o acesso ao banco | — |
| #15 | Integrações | Agenda (Google e Microsoft 365) e CI/CD (GitHub Actions e Vercel) | `0007_agenda_cicd` |
| #19 | Integrações | Resposta do agente no Slack (F2) | — |
| #24 | Integrações | Diagnóstico e simulador das integrações (ferramentas de teste) | — |
| #18 | Funções | Quem sabe e pergunta livre (etapa 7) | — |
| #20 | Funções | Nota do dia com confirmação (etapa 8) | — (ver B4) |
| #22 | Funções | Revisão noturna em lote e plano da manhã (etapa 9) | `0005_revisao_arquivos` (ver B5) |
| #25 | Funções | Correção em ambiente isolado e PR em rascunho (etapa 10) | `0005` e `0006_correcao` (ver B5) |
| #26 | Funções | Redistribuição por regra com aprovação (etapa 11) | `0005` e `0006` (ver B5) |
| #28 | Funções | Relatório semanal com crédito por ajuda (etapa 12) | `0005` e `0006` (ver B5 e B10) |
| #29 | Integrações | Espelho das notas no repositório `brains` (etapa 14) | — |

A pilha de Integrações foi atualizada com a `main` depois do merge do #16 e do #23, e o único conflito foi no `.env.example`. No topo da pilha (#24), passam os tipos, o lint, os 321 testes e a avaliação fixa por regra (15 de 15, sem falha de segurança).

**Ordem de merge da frente de Integrações:** #3 → #5 → #7 → #8 → #11 → #14 → #15 → #19 → #24 → #29, cada um com **merge commit**. Os PRs estão empilhados: enquanto o anterior não entra, a diferença de cada um mostra também os commits do anterior.

## 2. Bloqueios

Cada bloqueio traz quem resolve e o que destrava.

### B1. Contas e credenciais das plataformas ainda não existem

**Dono:** Integrações e Avaliador, com o administrador de cada plataforma.
**Impacto:** nada foi testado contra Slack, GitHub, Linear, agenda, Vercel ou Anthropic de verdade. Os testes automatizados usam plataformas simuladas, e as chamadas reais só foram feitas com credenciais falsas, para conferir as mensagens de erro.
**Destrava:** criar as contas da seção 3 e preencher o `.env`.

### Resolvidos: B2, B3 e B9

Entraram na `main` com o #23:
- **B2:** a nota do produto pula a empresa apagada no meio da varredura, e a CI deixou de falhar de forma intermitente.
- **B3:** pedido de gravação de vídeo pelo chat é recusado por regra.
- **B9:** o modo de ensaio `DEMO_ALWAYS_AWAY` foi incluído no fluxo de resposta.

### B4. #20 em conflito e com um segundo consumidor da fila de cliques

**Dono:** Funções, com Integrações.
**Causa:** o `apps/worker/src/end-of-day.ts` do #20 registra um consumidor da fila `slack.interaction`, e o #19 registra outro (Resolveu e Não resolveu). No pg-boss, **cada clique vai para só um consumidor**, então o "Confirmar" da nota do dia pode cair no tratador errado e se perder.
**Correção:** o #19 traz um roteador único em `apps/worker/src/slack-interactions.ts`. No #20, trocar `queue.work(QUEUES.slackInteraction, …)` por `interactions.add("nota_do_dia", (job) => w.flow.confirmFromSlack(job.orgId, job.payload))`. Se o #20 entrar antes, a troca é feita no #19.
**Além disso:** o #20 precisa ser atualizado com a `main`.

### B5. Numeração das migrações

**Dono:** quem entrar por último.
**Situação:** a `main` vai até a `0004_busca_cerebro`, e duas frentes usam os mesmos números:
- Integrações: `0005_outbox_inicio` (#7), `0006_ausencia_rh` (#11) e `0007_agenda_cicd` (#15);
- Funções: `0005_revisao_arquivos` (#22, e repetida no #25 e no #26) e `0006_correcao` (#25 e #26).

O Drizzle aplica as migrações pela ordem do `meta/_journal.json`. Duas migrações `0005` quebram o `pnpm db:migrate` de quem fizer o segundo merge.

**Regra:** quem entrar por último renumera, sem editar uma migração que já está na `main`:
1. pegar o `meta/` da `main`;
2. apagar os próprios `.sql`;
3. rodar `pnpm db:generate`;
4. recolocar o SQL escrito à mão (no #15, o RLS de `deployments`).

Se a pilha de Integrações entrar primeiro, as migrações de Funções passam a começar na `0008`.

### B10. Ações sem aprovação ficariam paradas no outbox (#22 a #28 com o #7)

**Dono:** Funções.
**Causa:** o `createPgOutbox.enqueue` (`packages/actions/src/pg.ts`, a partir do #22) grava `state = "approved"` só quando há `approvedBy`. As ações que dispensam aprovação, como o comentário da revisão noturna (`github.comment`), entram como `pending`. O executor do #7 só roda as `approved`, então elas nunca saem.
**Além disso:** o `enqueue` dele recusa com erro uma ação que exige aprovação e ainda não tem aprovador. No #7, essa ação entra como `pending` e espera a aprovação (`approveAction`), que é como a tela de aprovações funciona.
**Correção sugerida:** depois do merge do #7, fazer o `createPgOutbox(db, orgId).enqueue(a)` chamar `enqueueAction(db, orgId, a)`, do `packages/actions/src/executor.ts`. Se o #22 entrar antes, a correção mínima é `state: action.approvedBy || !REQUIRES_APPROVAL[action.type] ? "approved" : "pending"`.

### B6. Avaliação com o modelo real não rodou

**Dono:** Avaliador.
**Situação:** `pnpm evals` só rodou sem chave, exercitando o caminho por regra. Com o fluxo do #16 mais o #23, deu 15 de 15.
**Destrava:** `ANTHROPIC_API_KEY` da organização e a aprovação do custo, que é baixo (15 perguntas com o Sonnet 5.5, esforço baixo).

### B7. Hospedagem na Render

**Dono:** Avaliador.
**Situação:** o Blueprint (`infra/render.yaml`) usa o plano pago `starter` (US$ 7 por mês por serviço, quatro serviços) e o banco `basic-256mb`. O comando de migração antes do deploy e os processos em segundo plano não rodam no plano gratuito. Confirme os valores atuais antes de criar.
**Destrava:** decidir o plano, criar o Blueprint e preencher as variáveis marcadas como `sync: false`.

### B8. Permissões desta sessão de trabalho

**Situação:** o assistente não consegue comentar em PRs, por causa da regra de escritas em sistemas externos. Por isso os avisos de B4, B5 e B10 estão aqui, e não nos PRs do Eduardo.
**Destrava:** repassar este documento ao Eduardo, ou liberar a ação em `/permissions`.

## 3. O que configurar

### Contas (uma vez)

| Plataforma | O que criar | Guia |
|---|---|---|
| Slack | Espaço de teste e app pelo manifesto `infra/slack-manifest.yml` | teste-integracoes, passo 2 |
| GitHub | Organização de teste, repositório público `app` e GitHub App instalado nele | passo 2 |
| Linear | Espaço de teste e chave pessoal ou app OAuth, mais o webhook de Issues | passo 2 |
| Anthropic | Organização, limite de gasto e chave de API | etapa 6 do manual |
| Render | Blueprint a partir de `infra/render.yaml` | B7 |
| Google Workspace ou Microsoft 365 | Conta de serviço com delegação, ou app no Entra com consentimento do administrador | teste I |
| Vercel | Projeto do repositório de teste e webhook de deploys | teste J |
| Langfuse (opcional) | Projeto, com chave pública e secreta | etapa 1 do manual |

### Variáveis por serviço

Toda variável é validada em `packages/config`, e o serviço falha cedo, com mensagem clara, se ela estiver errada.

| Variável | api | web | worker | Origem |
|---|:-:|:-:|:-:|---|
| `DATABASE_URL` | ✔ | ✔ | ✔ | Render (banco) ou `docker compose` local |
| `ENCRYPTION_KEY` | ✔ | | ✔ | `openssl rand -hex 32`, a mesma nos serviços. Trocar invalida as credenciais guardadas |
| `GITHUB_WEBHOOK_SECRET` | ✔ | | | GitHub App → Webhook secret |
| `SLACK_SIGNING_SECRET` | ✔ | | | App do Slack → Basic Information |
| `LINEAR_WEBHOOK_SECRET` | ✔ | | | Webhook do Linear |
| `VERCEL_WEBHOOK_SECRET` | ✔ | | | Webhook de deploys da Vercel |
| `SLACK_BOT_TOKEN` | | | ✔ | App do Slack → Bot User OAuth Token (`xoxb-…`) |
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` | | | ✔ | GitHub App (chave `.pem` numa linha, com `\n`) |
| `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` ou `LINEAR_API_KEY` | | | ✔ | App OAuth do Linear, ou chave pessoal para testes |
| `ANTHROPIC_API_KEY` | | ✔ | ✔ | Anthropic. Sem ela, o agente responde só por regra |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` | | | ✔ | Conta de serviço do Google, com delegação no domínio |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | | | ✔ | App multi-tenant no Microsoft Entra |
| `BRAINS_REPOSITORY`, `RECONCILE_INTERVAL_MS` | | | ✔ | Repositório do espelho das notas; intervalo da reconciliação (padrão: 10 min) |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | | ✔ | | App do Slack → Basic Information (login no painel) |
| `SESSION_SECRET` | | ✔ | | Gerado pelo Blueprint; local: `openssl rand -hex 32` |
| `PANEL_URL` | | ✔ | | Endereço público do painel |
| `DEMO_MODE` | ✔ | ✔ | ✔ | `true` no evento: login por persona e simulador |
| `LANGFUSE_*` | opcional | opcional | opcional | Langfuse |

**Para ligar a empresa de teste** (`pnpm integracoes:ligar`): `DEMO_ORG_NAME`, `DEMO_SLACK_TEAM_ID`, `DEMO_GITHUB_INSTALLATION_ID`, `DEMO_LINEAR_ORG_ID`, `DEMO_GOOGLE_DOMAIN`, `DEMO_MICROSOFT_TENANT_ID`, `DEMO_VERCEL_TEAM_ID` e `DEMO_IDENTITIES`, que lista as pessoas e as contas de cada uma. `pnpm integracoes:conferir` mostra os ids que vão nessas variáveis.

**Para o aviso de RH:** `pnpm integracoes:rh` gera o segredo da empresa e mostra a URL a configurar no sistema de RH.

## 4. O que testar para validar

Na ordem. Cada etapa só faz sentido com a anterior verde.

### 4.1 Sem plataformas (já passando nos PRs de Integrações)

- [ ] `pnpm typecheck && pnpm test` com `pnpm db:up && pnpm db:migrate` num banco zerado. Os testes de banco rodam com um papel comum do Postgres, então o RLS vale de verdade.
- [ ] CI verde em cada PR, na ordem de merge, depois de cada merge.
- [ ] `pnpm db:seed && env -u ANTHROPIC_API_KEY DEMO_ALWAYS_AWAY=true pnpm evals` → **15 de 15** e 0 falha de segurança (já passa na `main`).

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
| K | Resposta no Slack como "Agente de Fernando", com fonte e volta prevista | Slack, Anthropic e o #16 |

### 4.3 Os 8 testes de "funcionando de verdade" (manual, etapa 16)

| # | Teste | Coberto por | Situação |
|---|---|---|---|
| 1 | Um push real no GitHub atualiza o registro | Teste B | pronto para testar (B1) |
| 2 | Com a pessoa ausente pelo fuso, uma pergunta real no Slack recebe resposta correta, com fonte | Teste K | depende do #19 (B2, B3) e de B1 |
| 3 | Um PR real recebe análise e correção preparada, e o plano da manhã mostra isso | Etapas 9 e 10 | **não construído** |
| 4 | Uma ausência no painel gera um plano e, com a aprovação do líder, altera tarefas reais | Teste D (ação aprovada) + etapa 11 | o executor está pronto; falta gerar o plano e a tela |
| 5 | Uma pessoa com poucos commits aparece no relatório com as ajudas | Etapa 12 | o crédito por ajuda está pronto; falta o relatório |
| 6 | Uma tentativa de injeção em comentário de PR não muda o comportamento | `pnpm evals` + teste K | caminho por regra passando; falta com o modelo (B6) |
| 7 | O painel mostra custo e rastro de cada execução | `agent_runs` gravado | falta a tela |
| 8 | Com os computadores de quem desenvolve desligados, tudo continua funcionando | Render | B7 |

### 4.4 Roteiro da demo (manual, aba Demo)

As cinco cenas, em 3 minutos: a pergunta que esperaria um dia, a manhã de Fernando, as férias de Bruno, o trabalho invisível, e custo, rastro e ganhos. Ensaie com o cronômetro só depois que a seção 4.3 estiver verde. Os dados são sintéticos, e o seed recria a demonstração (`pnpm db:seed`).

## 5. O que ainda não foi construído (escopo da demo)

| Item | Etapa | Frente |
|---|---|---|
| Revisão noturna em lote e plano da manhã | 9 | Funções |
| Correção em ambiente isolado | 10 | Funções (pode virar só sugestão, se o tempo apertar) |
| Plano de redistribuição a partir da ausência e tela de aprovação | 11 | Funções e Web (o executor já está pronto: #7) |
| Relatório semanal com crédito pelas ajudas | 12 | Funções e Web (o crédito já é gravado: #2 e #5) |
| Ganhos e resumo da ausência | 13 | Funções e Web |
| Painel com os dados reais (hoje usa as personas simuladas) e "Pergunte ao gêmeo" chamando `answer()` | 16 | Web |
| Telas de custo e execuções, a partir de `agent_runs` | 16 | Web |
| Revisão visual do card "Seu agente" (`/pessoas/[id]`, na própria ficha): campos de estilo e delegação, quadro "Nunca", lista "Decisões do seu agente" e o motivo nas correções de Meu plano. Hoje usa os tokens e componentes que já existiam, sem revisão de design. Arquivos: `apps/web/components/AgentProfileForm.tsx` e o bloco "Seu agente" em `apps/web/app/painel.css` | — | Web (Frente 3, design) |
| `defaultScope: "none"` como padrão em `createPool`, quando todas as frentes usarem `withOrg` | 2 | Funções (Integrações já usa, no #14) |
