# Divisão da equipe — Echo

Quatro frentes em paralelo. Cada frente é dona de pastas próprias, para quase não haver conflito de merge. Os pontos de contato entre as frentes são os **contratos** em `packages/*/src/index.ts`. Mudar um contrato exige avisar o time antes.

Situação em **7/11/2026, 21h**. O que bloqueia, o que configurar e o que testar está em [`pendencias.md`](pendencias.md).

## Prazos

| Quando | O quê |
|---|---|
| Sábado 7/11, 10h30 | Início do hacking. O repositório começa no dia |
| Sábado 7/11, 17h00 | Fim do primeiro dia |
| Domingo 8/11, 13h00 | **Prazo final de entrega** |
| Domingo 8/11, 16h00 | Demo Day: 3 minutos por time, e os jurados testam o sistema |

**A submissão exige:** descrição (problema, para quem, solução e como o agente funciona), vídeo de demonstração, link navegável e testável, material do pitch e a lista de ferramentas, modelos e APIs usados. Vale sinalizar o **Desafio Tako** (Digital Workers para RH).

**Critérios, com pesos iguais:** qualidade do protótipo e aderência ao desafio · viabilidade como startup · criatividade · pitch. Metade da nota é negócio.

## Como trabalhamos

1. Cada frente trabalha em branches com o prefixo dela, a partir da `main`: `integracoes/...`, `funcoes/...`, `web/...` e `avaliador/...` (infra e CI também em `avaliador/...`).
2. PRs pequenos, CI verde e revisão rápida por outra frente (o Avaliador revisa por padrão). Merge com **merge commit**.
3. **Depois do merge, a branch é apagada.** Trabalho novo começa numa branch nova, a partir da `main` atualizada. Commit empurrado numa branch já unida fica fora da `main`, como um commit fantasma.
4. Migração nova: pegue o `meta/` da `main` e rode `pnpm db:generate` depois de atualizar a branch. Não edite migração que já está na `main`.
5. Só dados sintéticos. Fernando, Eduardo e Yan têm o nome real, com trabalho sintético.

## Frente 1: Integrações com aplicativos

**Dona de:** `packages/connectors`, `apps/api` (webhooks, OAuth e aviso de RH), `packages/actions` (executor do outbox) e a configuração das plataformas (GitHub App, Slack, Linear, agenda e Vercel).

**Entregue:** webhooks com assinatura e sem duplicar (etapa 3), adaptadores do GitHub, Linear e Slack, reconciliação, executor do outbox (comentário, revisores, Linear, Slack, espelho, rascunho e união da correção), login no painel com o Slack e aviso de RH (etapa 15), agenda (etapa 18), CI/CD (etapa 19) e espelho das notas (etapa 14).

**Falta até a entrega:** os testes A a L contra as plataformas de verdade (`pendencias.md`, seção 4.2).

**Pronto quando:** um push real aparece em `work_events`, o reenvio não duplica e uma menção real no Slack recebe a resposta "Agente de Fernando".

## Frente 2: Funções (regras e agentes)

**Dona de:** `packages/domain`, `packages/brain`, `packages/agents`, `packages/db` (esquema, migrações e RLS), `seed/`, os fluxos em `apps/worker` e `apps/reviewer` (correção e delegação), além do uso do modelo aberto (triagem, resumo do dia e juiz da delegação).

**Entregue:** isolamento com RLS e escopo `"none"` por padrão (etapa 2), regras fixas (4), cérebro (5), resposta com validador (6), quem sabe (7), nota do dia (8), revisão noturna e plano da manhã (9), correção em ambiente isolado ligada ao GitHub (10), redistribuição (11), relatório com crédito por ajuda (12), ganhos (13), resumo do dia por modelo aberto (26) e "Seu agente": estilo e delegação escritos pela pessoa, com o juiz pequeno (#50).

**Falta até a entrega:** o merge do #50, o ok das outras frentes na proposta da regra 1 (B11) e o juiz da delegação com o Qwen3 de verdade.

**Pronto quando:** uma pergunta no painel ou no Slack recebe a resposta "Agente de Fernando" com fontes, a nota confirmada muda essa resposta, e um erro plantado num PR vira uma correção aprovável.

## Frente 3: Páginas web e visual

**Dona de:** `apps/web` (telas, estilos e componentes) e `packages/artifacts`. Mudança de tela feita por outra frente (por exemplo, o card "Seu agente" e os botões da correção em Meu plano) passa pela revisão visual desta frente.

**Entregue:** login por persona, ficha da pessoa com "Pergunte ao gêmeo", simulador, notas, Meu plano, Redistribuição, Relatórios, Ganhos, Custo e execuções, Resumos (etapa 26), landing e identidade visual.

**Falta até a entrega:** a revisão visual do card "Seu agente" (`apps/web/components/AgentProfileForm.tsx`) e dos botões Aprovar e Recusar da correção (`apps/web/app/(painel)/plano/PlanList.tsx`).

**Pronto quando:** o roteiro de 3 minutos da aba Demo pode ser clicado do começo ao fim.

## Frente 4: Avaliador (qualidade, segurança, infra e demo)

**Dona de:** `evals/`, os testes ponta a ponta (Playwright), `.github/workflows`, `infra/` (Blueprint da Render e imagens, inclusive a do modelo aberto) e a submissão.

**Entregue:** CI e deploy pela Render via Actions, com a migração antes do código; os 15 casos fixos de segurança e 3 de idioma (inglês e espanhol), que passam com o modelo real (18 de 18).

**Falta até a entrega:**

| O quê | Detalhe |
|---|---|
| Render | Criar o `echo-reviewer` do Blueprint e preencher as variáveis (B7) |
| `pnpm e2e` | História da demo no navegador, sem modelo, na CI (B12) |
| Submissão | Roteiro ensaiado com cronômetro, vídeo, README e lista de ferramentas usadas (incluindo o Claude Code) |
| Negócio | Problema e quanto custa (espera entre fusos), tamanho de mercado, "por que agora", concorrentes (Viven, Twin1) e quem paga (o RH). Pitch de 3 minutos, texto da submissão e Desafio Tako |
| Prêmio | Domínio próprio, landing page e e-mail corporativo no mesmo domínio, exigidos para resgatar os créditos AWS |

**Pronto quando:** a avaliação passa sem violação, a CI roda o e2e e um jurado consegue testar só com o link.

## Contratos entre as frentes

| Contrato | Arquivo | Quem implementa | Quem usa |
|---|---|---|---|
| Esquema do banco | `packages/db/src/schema.ts` | Funções (RLS) | Todos |
| Tipos e regras puras | `packages/domain/src/index.ts` | Funções | Integrações, Web |
| Portas das plataformas (leitura e escrita) | `packages/connectors/src/index.ts` | Integrações | Funções, Actions |
| Porta da correção (`FixCodeHost`) | `packages/agents/src/fix.ts`, com `fixHostOf` em `packages/connectors` | Funções e Integrações | Reviewer, Web |
| Cérebro | `packages/brain/src/index.ts` | Funções | Web |
| Saída do agente e validador | `packages/agents/src/index.ts` | Funções | Avaliador, Web |
| Ações aprovadas (outbox) | `packages/actions/src/index.ts` | Integrações | Funções, Web |
| Resumo interativo | `packages/artifacts/src/index.ts` | Web | Funções, Avaliador |
| Fila | `packages/jobs/src/index.ts` | pronto | Todos |

## Se o tempo apertar

- **Cortar nesta ordem:** a delegação (sem `SLM_OLLAMA_URL` no reviewer, toda correção espera o autor), a correção em ambiente isolado (o reviewer fora da Render; a revisão noturna continua comentando) e o Linear real (fica simulado).
- **Não cortar:** a resposta com fonte, o plano da manhã, a redistribuição aprovada e o relatório com crédito pelas ajudas.
