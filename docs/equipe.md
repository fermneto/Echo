# Divisão da equipe — Echo

Quatro frentes em paralelo a partir das **10:30**. Cada frente é dona de pastas próprias, para quase não haver conflito de merge. Os pontos de contato entre as frentes são os **contratos já escritos** em `packages/*/src/index.ts`. Mudar um contrato exige avisar o time antes.

## Prazos do Converge Challenge

| Quando | O quê |
|---|---|
| Sábado 7/11, 10h30 | Início do hacking. Nenhum código do projeto antes disso, e o repositório começa no dia. |
| Sábado 7/11, 17h00 | Fim do primeiro dia |
| Domingo 8/11, 13h00 | **Prazo final de submissão**, pelo painel da Canastra |
| Domingo 8/11, 16h00 | Demo Day: 3 minutos por time, e os jurados testam o sistema |

**A submissão exige:** descrição (problema, para quem, solução e como o agente funciona), vídeo de demonstração, link navegável e testável, material do pitch e a lista de ferramentas, modelos e APIs usados. Vale sinalizar o **Desafio Tako** (Digital Workers para RH).

**Critérios, com pesos iguais:** qualidade do protótipo e aderência ao desafio · viabilidade como startup · criatividade · pitch. Metade da nota é negócio.

### Escopo que cabe em cerca de 11 horas

Montamos primeiro o roteiro da demo, no ar na Render, com dados sintéticos:

1. Base e dados: o monorepo, o esquema e o seed das personas (etapas 1 e 2).
2. As regras: `isAway`, `branchStatus`, `capacityCard`, `planOptions` e `weeklyMetrics` (etapa 4).
3. A resposta com fonte, "Agente de Fernando", pelo painel e pelo simulador (etapa 6), e depois pelo Slack real.
4. A nota do dia e o plano da manhã (etapas 8 e 9, sem o lote real).
5. A redistribuição aprovada, mudando o Linear de verdade ou simulado (etapa 11).
6. O relatório com crédito pelas ajudas e a visão do RH (etapa 12).
7. Custo e execuções a partir de `agent_runs`, com as barreiras de segurança testadas ao vivo.

O resto das 28 etapas vira "próximos passos" no pitch.

## Antes das 10:30 (sem commits)

| Quem | O quê |
|---|---|
| Todos | Instalar Node 24, Docker e `corepack enable pnpm`. Ler `CLAUDE.md` (regras invioláveis) e a aba Demo do manual. |
| Integrações | Criar as contas: org de teste no GitHub (`<org>-teste/app` público), **GitHub App**, espaço do **Slack** e app interno, espaço do **Linear** e app OAuth (ver `docs/engenharia.md` → Contas e variáveis). Gerar `ENCRYPTION_KEY` com `openssl rand -hex 32`. |
| Funções | Criar a conta da **Anthropic** (organização, limite de gasto, `ANTHROPIC_API_KEY`). Ler a aba Regras. |
| Web/Visual | Rascunhar o layout do painel e do escritório em pixel art. Ler a aba Painel (telas, endereços, quem vê). |
| Avaliador | Criar a conta da **Render**. Conferir as regras e os critérios do hackathon e listar os entregáveis (repositório, vídeo, link, ferramentas declaradas). |

## 10:30: ponto de partida

1. Uma pessoa faz o commit inicial da base (etapas 0 e 1 e os contratos), envia para a `main` e cria o Blueprint na Render.
2. Cada frente abre a sua branch a partir da `main`: `integracoes/...`, `funcoes/...`, `web/...` e `avaliador/...`.
3. Fluxo de trabalho: PRs pequenos, CI verde e revisão rápida por outra frente (o Avaliador revisa por padrão).

## Frente 1: Integrações com aplicativos

**Dona de:** `packages/connectors`, `apps/api` (rotas de webhook), `packages/actions` e a configuração das plataformas.

| Etapa | Entrega |
|---|---|
| 3 | `/webhooks/github`, `/webhooks/slack`, `/webhooks/slack/interacoes` e `/webhooks/linear`: validar a assinatura, gravar em `inbox_events`, enfileirar e responder 200 no prazo (3 s Slack, 5 s Linear, 10 s GitHub). Descartar na entrada a mensagem do Slack que não interessa. |
| 3 | Adaptadores das portas `CodeHost`, `IssueTracker` e `ChatPlatform`, mais o `ingest.ts`, que normaliza para `work_events`, `tasks` e `pull_requests`. |
| 3 | Renovação de tokens com trava, AES-256-GCM, reconciliação no worker e ligação de identidades (sem adivinhar o autor). |
| 11 e 12 | `packages/actions`: o executor do outbox (troca de responsável no Linear, comentário no PR, aviso no Slack) e a ajuda confirmada por reação no Slack. |
| 15 | Login no painel com o Slack (OAuth) e aviso de RH assinado. |
| depois | 17 (camada de conexões), 18 (agenda) e 19 (CI/CD). |

**Pronto quando:** um push real aparece em `work_events`, o reenvio não duplica e uma menção real no Slack chega ao fluxo F2.

## Frente 2: Funções (regras e agentes)

**Dona de:** `packages/domain`, `packages/brain`, `packages/agents`, `packages/db` (RLS) e `seed/`, além dos fluxos em `apps/worker`.

| Etapa | Entrega |
|---|---|
| 2 | Migração de isolamento (RLS, `withOrg`, chaves compostas com `org_id`) e `pnpm db:seed` com as personas e as histórias da demo. **Prioridade 1: todas as outras frentes dependem do seed.** |
| 4 | Implementar as regras de `packages/domain/src/rules.ts` (`isAway`, `branchStatus`, `capacityCard`, `planOptions`, `weeklyMetrics`, `peopleForTopic` e `costLevel`), com testes de fuso. |
| 5 | `BrainStore` em Postgres: busca de texto, versões e permissões. |
| 6 | Laço de resposta (`answer.ts`, Sonnet 5.5, 4 rodadas e 30 s), ferramentas somente leitura, validador e resposta por regra. |
| 7 a 13 | Quem sabe, nota do dia, revisão noturna e plano da manhã, redistribuição, relatório e ganhos. |

**Pronto quando:** uma pergunta no painel ou no Slack recebe a resposta "Agente de Fernando" com fontes, e a nota confirmada muda essa resposta.

## Frente 3: Páginas web e visual

**Dona de:** `apps/web` e `packages/artifacts`.

| Etapa | Entrega |
|---|---|
| 16 | Login por persona (`DEMO_MODE`), a ficha da pessoa com "Pergunte ao gêmeo" e o simulador, que usa o mesmo fluxo do Slack. |
| 5 | Telas de notas: lista, edição e histórico. |
| 9 e 11 | Meu plano (reordenar, descartar, aprovar correção) e Redistribuição (registrar ausência, aprovar plano). |
| 12 e 13 | Relatórios (observação marcada, simular envio, visão do RH) e Ganhos (só totais). |
| 16 | Escritório em pixel art (cada pessoa no seu fuso, móveis que abrem as ferramentas) e Custo e execuções. |
| 26 | Resumos interativos em `/resumos/[id]`, montados a partir da `ArtifactSpec`. |

Enquanto o seed e as regras não ficam prontos, a frente trabalha com dados simulados com os tipos de `@echo/domain`.

**Pronto quando:** o roteiro de 3 minutos da aba Demo pode ser clicado do começo ao fim.

## Frente 4: Avaliador (qualidade, segurança e demo)

**Dona de:** `evals/`, os testes ponta a ponta (Playwright), `.github/workflows`, `infra/` e a submissão.

| Etapa | Entrega |
|---|---|
| 1 | Render no ar com os quatro serviços e a CI verde. |
| 6 | `evals/`: os 15 casos fixos (injeção, liberação falsa, sem permissão, avaliação de pessoa…) rodando com o modelo real e o workflow `evals.yml`. |
| 6 | Casos de teste do validador: liberação falsa, frases negadas, primeira pessoa e número inventado. |
| 16 | `pnpm e2e` com a história da demo no navegador, sem modelo, na CI. |
| sempre | Revisar os PRs das outras frentes contra as regras invioláveis e conferir os 8 testes de "funcionando de verdade". |
| final | Roteiro da demo ensaiado com cronômetro, vídeo, README, lista de ferramentas usadas (incluindo o Claude Code) e checagem dos critérios do hackathon. |
| negócio | Metade da nota: problema e quanto custa (espera entre fusos), tamanho de mercado, "por que agora", concorrentes (Viven, Twin1) e quem paga (o RH). Pitch de 3 minutos, texto da submissão e Desafio Tako. |
| prêmio | Domínio próprio, landing page e e-mail corporativo no mesmo domínio: são exigidos para resgatar os créditos AWS. |

**Pronto quando:** a avaliação passa sem violação, a CI roda o e2e e um jurado consegue testar só com o link.

## Contratos entre as frentes (já no código)

| Contrato | Arquivo | Quem implementa | Quem usa |
|---|---|---|---|
| Esquema do banco (29 tabelas) | `packages/db/src/schema.ts` | Funções (RLS) | Todos |
| Tipos e regras puras | `packages/domain/src/{types,rules}.ts` | Funções | Integrações, Web |
| Portas das plataformas | `packages/connectors/src/index.ts` | Integrações | Funções |
| Cérebro | `packages/brain/src/index.ts` | Funções | Web |
| Saída do agente e validador | `packages/agents/src/index.ts` | Funções | Avaliador, Web |
| Ações aprovadas (outbox) | `packages/actions/src/index.ts` | Integrações | Funções, Web |
| Resumo interativo | `packages/artifacts/src/index.ts` | Web | Funções, Avaliador |
| Fila | `packages/jobs/src/index.ts` | pronto | Todos |

## Se o tempo apertar

- **Cortar nesta ordem:** o espelho do Obsidian (fica só a exportação), a correção de código (fica só a sugestão) e o Linear real (fica simulado).
- **Não cortar:** a resposta com fonte, o plano da manhã, a redistribuição aprovada e o relatório com crédito pelas ajudas.
