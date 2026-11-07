# Pendências: bloqueios, configuração e validação

Situação em **7/11/2026, 21h**. Aqui fica o que impede avançar, o que falta configurar e o que testar para dar o Echo como funcionando. O guia de cada integração (conta, variáveis, conferência e validação) está em [`integracoes/`](integracoes/README.md). Quem cuida de cada parte está em [`equipe.md`](equipe.md).

**Prazo:** entrega no domingo, 8/11, às 13h. Demo Day às 16h.

## 1. Onde estamos

**Na `main`** (último merge: #29, espelho das notas):

| Etapa | O quê | Frente |
|---|---|---|
| 1 | Base, CI e deploy pela Render via Actions (#39) | Avaliador |
| 2 | Esquema, seed, isolamento com RLS e `withOrg` | Funções |
| 3 | Webhooks, adaptadores, reconciliação e executor do outbox | Integrações |
| 4 a 6 | Regras fixas, cérebro, resposta com validador e resposta por regra | Funções |
| 7 a 13 | Quem sabe, nota do dia, revisão noturna com triagem por modelo aberto (#46), correção, redistribuição, relatório e ganhos | Funções |
| 14 | Espelho das notas no repositório `brains` (#29) | Integrações |
| 15 | Aviso de RH assinado e login no painel com o Slack | Integrações |
| 16 | Painel com dados reais, roteiro da demo, custo e execuções (#32, #34, #45, #47) | Web |
| 18 e 19 | Agenda (Google e Microsoft 365) e CI/CD (GitHub Actions e Vercel) | Integrações |
| 26 | Resumo do dia interativo montado por modelo aberto (#48, #49) | Funções e Web |

**PR aberto:**

| PR | Frente | O quê |
|---|---|---|
| [#50](https://github.com/fermneto/Echo/pull/50) | Funções | "Seu agente": estilo e delegação em texto livre, com juiz pequeno. Também traz a correção noturna ligada ao GitHub de ponta a ponta, o escopo `"none"` como padrão do banco e esta atualização dos documentos |

**Fora do escopo da demo (próximos passos no pitch):** etapas 17 (camada de conexões), 20 (incidentes e plantão), 21 e 22 (trackers e chat alternativos), 23 (base de conhecimento), 24 (RH e diretório), 25 (API pública) e 27 (vídeos das entregas).

## 2. Bloqueios e decisões em aberto

### B1. Testes contra as plataformas de verdade

**Dono:** Integrações.
**Situação:** a empresa de teste das integrações existe (#43), mas a seção 4.2 ainda não foi marcada como verificada.
**Destrava:** rodar os testes A a K e marcar o resultado aqui.

### B7. Hospedagem na Render

**Dono:** Avaliador.
**Situação:** banco, API e painel no plano gratuito; worker, triagem (`echo-triage`) e reviewer (`echo-reviewer`) são pagos. O reviewer entrou no Blueprint nesta atualização: falta criá-lo e preencher `FIX_AGENT_ID`, `FIX_ENVIRONMENT_ID`, `ANTHROPIC_API_KEY` e o GitHub App. O painel (`echo-web`) também passa a pedir `GITHUB_APP_ID` e `GITHUB_PRIVATE_KEY`, para aprovar a correção em Meu plano.
**Destrava:** aplicar o Blueprint e rodar `pnpm --filter @echo/reviewer provision` uma vez.

### B11. Regra 1 com a delegação escrita

**Dono:** todas as Frentes.
**Situação:** o `CLAUDE.md` traz a proposta da Frente 2: a delegação escrita pela própria pessoa conta como aprovação registrada feita antes por ela, só para unir no PR dela a correção da revisão noturna, depois das travas fixas, do juiz e da conferência do rascunho.
**Destrava:** o ok das outras Frentes no [#50](https://github.com/fermneto/Echo/pull/50). Sem o ok, basta deixar o `SLM_OLLAMA_URL` vazio no reviewer: toda correção espera o autor.

### B12. Teste ponta a ponta no navegador (`pnpm e2e`)

**Dono:** Avaliador.
**Situação:** o comando ainda só avisa "etapa 16 (frente Avaliador)" e sai com erro.

### Resolvidos nesta rodada

- **B2, B3, B9:** entraram com o #23.
- **B4** (dois consumidores da fila de cliques) e **B10** (ações sem aprovação paradas no outbox): resolvidos no merge da Frente 2 (#30 e o roteador único em `slack-interactions.ts`).
- **B5** (numeração das migrações): a `main` vai até a `0011_resumo_do_dia`; o #50 traz a `0012_estilo_delegacao`.
- **B6** (avaliação com o modelo real): `pnpm evals` com o Claude Sonnet 5.5 deu **15 de 15**, sem falha de segurança (7/11, cerca de US$ 0,17).
- **B8** (permissões da sessão): não se aplica mais.
- **Correção sem GitHub:** o reviewer rodava com `codeHost: () => null`, e o executor não sabia abrir o rascunho nem unir a correção. Agora os dois funcionam, com testes (#50).
- **`defaultScope: "none"`:** agora é o padrão de `createPool`. Conferido com o painel rodando com um papel do Postgres sem BYPASSRLS (#50).

## 3. O que configurar

### Contas (uma vez)

| Plataforma | O que criar | Guia |
|---|---|---|
| Slack | Espaço de teste e app pelo manifesto `infra/slack-manifest.yml` | teste-integracoes, passo 2 |
| GitHub | Organização de teste, repositório público `app` e GitHub App instalado nele (Contents e Pull requests em *Read and write*) | passo 2 |
| Linear | Espaço de teste e chave pessoal ou app OAuth, mais o webhook de Issues | passo 2 |
| Anthropic | Organização, limite de gasto e chave de API | etapa 6 do manual |
| Managed Agents | Agente e ambiente da correção: `pnpm --filter @echo/reviewer provision` | etapa 10 |
| Render | Blueprint a partir de `infra/render.yaml` | B7 |
| Google Workspace ou Microsoft 365 | Conta de serviço com delegação, ou app no Entra com consentimento do administrador | teste I |
| Vercel | Projeto do repositório de teste e webhook de deploys | teste J |
| Langfuse (opcional) | Projeto, com chave pública e secreta | etapa 1 do manual |

### Variáveis por serviço

Toda variável é validada em `packages/config`, e o serviço falha cedo, com mensagem clara, se ela estiver errada.

| Variável | api | web | worker | reviewer | Origem |
|---|:-:|:-:|:-:|:-:|---|
| `DATABASE_URL` | ✔ | ✔ | ✔ | ✔ | Render (banco) ou `docker compose` local |
| `ENCRYPTION_KEY` | ✔ | | ✔ | | `openssl rand -hex 32`, a mesma nos serviços. Trocar invalida as credenciais guardadas |
| `GITHUB_WEBHOOK_SECRET` | ✔ | | | | GitHub App → Webhook secret |
| `SLACK_SIGNING_SECRET` | ✔ | | | | App do Slack → Basic Information |
| `LINEAR_WEBHOOK_SECRET` | ✔ | | | | Webhook do Linear |
| `VERCEL_WEBHOOK_SECRET` | ✔ | | | | Webhook de deploys da Vercel |
| `SLACK_BOT_TOKEN` | | | ✔ | | App do Slack → Bot User OAuth Token (`xoxb-…`) |
| `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` | | ✔ | ✔ | ✔ | GitHub App (chave `.pem` numa linha, com `\n`) |
| `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` ou `LINEAR_API_KEY` | | | ✔ | | App OAuth do Linear, ou chave pessoal para testes |
| `ANTHROPIC_API_KEY` | | ✔ | ✔ | ✔ | Anthropic. Sem ela, o agente responde só por regra e não há correção |
| `SLM_OLLAMA_URL`, `SLM_MODEL`, `TRIAGE_TIMEOUT_MS` | | | ✔ | ✔ | `echo-triage` (Qwen3 4B). No reviewer, liga o juiz da delegação |
| `FIX_AGENT_ID`, `FIX_ENVIRONMENT_ID` | | | | ✔ | `pnpm --filter @echo/reviewer provision` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` | | | ✔ | | Conta de serviço do Google, com delegação no domínio |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | | | ✔ | | App multi-tenant no Microsoft Entra |
| `BRAINS_REPOSITORY`, `RECONCILE_INTERVAL_MS` | | | ✔ | | Repositório do espelho das notas; intervalo da reconciliação (padrão: 10 min) |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | | ✔ | | | App do Slack → Basic Information (login no painel) |
| `SESSION_SECRET` | | ✔ | | | Gerado pelo Blueprint; local: `openssl rand -hex 32` |
| `PANEL_URL` | | ✔ | | | Endereço público do painel |
| `DEMO_MODE` | ✔ | ✔ | ✔ | | `true` no evento: login por persona e simulador |
| `LANGFUSE_*` | opcional | opcional | opcional | opcional | Langfuse |

**Para ligar a empresa de teste** (`pnpm integracoes:ligar`): `DEMO_ORG_NAME`, `DEMO_SLACK_TEAM_ID`, `DEMO_GITHUB_INSTALLATION_ID`, `DEMO_LINEAR_ORG_ID`, `DEMO_GOOGLE_DOMAIN`, `DEMO_MICROSOFT_TENANT_ID`, `DEMO_VERCEL_TEAM_ID` e `DEMO_IDENTITIES`, que lista as pessoas e as contas de cada uma. `pnpm integracoes:conferir` mostra os ids que vão nessas variáveis.

**Para o aviso de RH:** `pnpm integracoes:rh` gera o segredo da empresa e mostra a URL a configurar no sistema de RH.

## 4. O que testar para validar

Na ordem. Cada etapa só faz sentido com a anterior verde.

### 4.1 Sem plataformas

- [x] `pnpm typecheck && pnpm test` com o banco migrado: 16 de 16 pacotes (7/11, no ramo do #50). Os testes de banco rodam com um papel comum do Postgres, então o RLS vale de verdade.
- [x] `pnpm evals` com o modelo real: 15 de 15, sem falha de segurança (7/11).
- [ ] CI verde no #50.

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
| L | Erro plantado num PR → correção em rascunho → aprovada em Meu plano (ou pela delegação) → unida no PR | GitHub App, Anthropic, Managed Agents e reviewer |

### 4.3 Os 8 testes de "funcionando de verdade" (manual, etapa 16)

| # | Teste | Coberto por | Situação |
|---|---|---|---|
| 1 | Um push real no GitHub atualiza o registro | Teste B | construído; falta o teste real (B1) |
| 2 | Com a pessoa ausente pelo fuso, uma pergunta real no Slack recebe resposta correta, com fonte | Teste K | construído; falta o teste real (B1) |
| 3 | Um PR real recebe análise e correção preparada, e o plano da manhã mostra isso | Etapas 9 e 10, teste L | construído e testado com GitHub simulado; falta o reviewer na Render (B7) |
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
| Revisão visual do card "Seu agente" (`/pessoas/[id]`) e dos botões Aprovar e Recusar da correção em Meu plano, que usam os componentes que já existiam, sem revisão de design. Os arquivos são `apps/web/components/AgentProfileForm.tsx`, `apps/web/app/(painel)/plano/PlanList.tsx` e o bloco "Seu agente" em `apps/web/app/painel.css` | Web (Frente 3) |
| Render com o reviewer (B7), `pnpm e2e` (B12), vídeo, README e lista de ferramentas | Avaliador |
| Ok na proposta da regra 1 (B11) e revisão do #50 | Todas |
| Juiz da delegação com o Qwen3 de verdade: ver a nota no #50 | Funções |
