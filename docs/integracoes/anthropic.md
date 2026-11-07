# Anthropic (Claude)

## O que o Echo faz

- **Responde** a colegas pelo agente da pessoa ausente, ou pelo agente da equipe, com o Claude Sonnet 5.5 em esforço baixo, até 4 rodadas e 30 s. As ferramentas são somente leitura, e a saída é estruturada.
- **Recusa e regras em código:** um validador derruba fonte inventada, liberação falsa, primeira pessoa, avaliação de pessoas e número fora das regras. Nesses casos vale a resposta por regra.
- **Teto de custo por empresa:** com 80% do limite, param a correção e os vídeos. Com 100%, param as perguntas livres, mas o agente de quem está ausente segue. Com 200%, todos respondem por regra.
- **Registra** cada execução em `agent_runs`, com tokens, custo, ferramentas e resultado.

**Sem chave**, o agente responde só por regra, com o que está registrado. Isso já é testável hoje. Para saber se uma resposta usou o modelo, veja `agent_runs.result`: `ok` usou o modelo; `fallback` e `refused` saíram por regra.

**PRs:** o fluxo de resposta é o #16 (frente Funções), com as correções do #23. O caminho até o Slack é o #19.

## Criar a chave

1. Em [platform.claude.com](https://platform.claude.com), crie a organização e um projeto para o Echo.
2. Defina orçamento e **limite de gasto mensal**. A assinatura individual do claude.ai não serve: é preciso a chave de API da organização.
3. Crie a chave de API, que vai para `ANTHROPIC_API_KEY`.
4. Para a avaliação na CI, adicione a chave como segredo do repositório.

## Variáveis

| Variável | Serviço | Observação |
|---|---|---|
| `ANTHROPIC_API_KEY` | worker, web | Começa com `sk-ant-`. Sem ela, só a resposta por regra |

O limite mensal de cada empresa fica em `orgs.monthly_limit_usd` (padrão US$ 50).

## Validar

### A1. Avaliação fixa de segurança (sem custo)

```bash
pnpm db:seed
env -u ANTHROPIC_API_KEY pnpm evals
# 15 de 15 passaram. Segurança: 0 falha(s). Conteúdo: 0 falha(s).
```

Sem a chave, isso exercita só o caminho por regra. É o mínimo antes de ligar o modelo.

### A2. Avaliação fixa com o modelo real (tem custo)

```bash
pnpm db:seed
pnpm evals
```

> Rode **fora do expediente das personas** (à noite ou no fim de semana). Vários casos pressupõem que o dono da pergunta está ausente, e o #16 ainda não tem um modo de ensaio que force isso (`pendencias.md`, B9).

Meta: **0 falha de segurança**, ou seja, nenhuma violação de permissão, nenhuma liberação falsa e nenhuma obediência a instrução injetada. Falha de conteúdo é relatada, mas não derruba o comando. São 15 perguntas com o Sonnet 5.5 em esforço baixo. O custo de cada uma aparece em `agent_runs`.

```sql
select result, model, input_tokens, output_tokens, cost_usd, error from agent_runs where flow = 'answer' order by created_at desc limit 15;
select sum(cost_usd) from agent_runs where created_at > now() - interval '1 hour';
```

Esperado:
- `result = ok` na maioria;
- `refused`, com o código em `error`, quando o validador derrubou a resposta do modelo e valeu a regra;
- custo por pergunta menor a partir da segunda, porque as instruções e as ferramentas ficam estáveis no início e entram no cache. O `agent_runs` guarda o total de tokens de entrada e o custo, não o cache separado.

### A3. Pela conversa

Com o [Slack](slack.md) ligado, faça o teste S2 do guia do Slack e confira em `agent_runs` que a resposta saiu com `result = ok` e `model = claude-sonnet-5-5`.

### A4. Teto de custo

```sql
update orgs set monthly_limit_usd = 0.01 where name = 'Empresa de teste (integrações)';
```

Pergunte de novo: o agente de quem está ausente responde por regra quando o gasto passa do dobro do limite. Volte o limite depois.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `agent_runs.result` é `fallback` ou `refused` | Sem chave, teto de custo atingido, ou o validador recusou a resposta do modelo (o motivo fica em `agent_runs.error`) |
| A configuração falha com `ANTHROPIC_API_KEY` | A chave não começa com `sk-ant-` |
| `401 authentication_error` | Chave revogada, ou de outra organização |
| `429` | Limite de taxa da organização: espere, ou suba o limite no console |
| `stop_reason: refusal` | O modelo recusou. O servidor tenta outro modelo, e se o segundo também recusar, vale a regra |
