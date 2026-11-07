# CI/CD: GitHub Actions e Vercel

## O que o Echo faz

- **GitHub Actions:** quando uma `check_suite` termina, o Echo atualiza o estado (passou, falhou, rodando ou neutro) e o link dos checks do PR. Só o commit atual do PR vale, e **nada de log é guardado**. Ao vivo, lê os checks de um commit e quais falharam.
- **Vercel:** os deploys de preview e de produção chegam por webhook assinado (HMAC-SHA1, `x-vercel-signature`) e ficam em `deployments`, com ambiente, estado, commit, branch e link. Um aviso atrasado não volta o estado para trás.
- **Para o agente:**
  - `ciStatus` responde "os testes passaram?": ao vivo no GitHub, ou com o último aviso, marcado como não ao vivo;
  - `deployStatus` responde "já está em produção?": o PR precisa estar unido e haver um deploy de produção pronto depois do merge.

**PRs:** #15 (dados e funções). O uso nas respostas do agente e no plano da manhã é da frente Funções.

## Configurar

**GitHub Actions:** o [GitHub App](github.md) já recebe `check_suite`. No repositório de teste, crie `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  teste:
    runs-on: ubuntu-latest
    steps:
      - run: echo ok
```

**Vercel:**
1. Importe o repositório de teste na Vercel, num time de teste.
2. Em **Team Settings → Webhooks**, crie um webhook para `https://<API>/webhooks/vercel` com os eventos de deployment (criado, sucesso, erro, cancelado, promovido). O segredo vai para `VERCEL_WEBHOOK_SECRET`, na API. O webhook de time depende do plano da Vercel; uma integração da Vercel envia os mesmos eventos.
3. No `.env`: `DEMO_VERCEL_TEAM_ID=<id do time>` (Team Settings → General). Depois rode `pnpm integracoes:ligar`.

## Validar

### C1. Checks

Abra um PR no repositório de teste (guia do GitHub, G1) e espere a CI terminar.

```sql
select number, head_sha, checks_state, checks_url, checks_updated_at from pull_requests order by updated_at desc limit 3;
```

Esperado: `checks_state = success` (ou `failure`) e o link `https://github.com/<org>/app/commit/<sha>/checks`. Um aviso de commit antigo não sobrescreve o atual.

### C2. Deploys

1. Faça push no PR: a Vercel cria um preview.
2. Una o PR: a Vercel publica em produção.

```sql
select environment, state, branch, left(sha, 7) as sha, url, occurred_at from deployments order by occurred_at desc limit 5;
```

Esperado: um `preview` em `ready` da branch do PR e, depois do merge, um `production` em `ready`.

### C3. Webhook recusado sem assinatura

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<API>/webhooks/vercel -H "x-vercel-signature: 00" -d '{"id":"x","type":"deployment.created"}'
# 401 (ou 503, sem VERCEL_WEBHOOK_SECRET)
```

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `checks_state` não muda | O GitHub App sem o evento **Check suite**, ou sem permissão *Checks: Read* |
| Vercel 401 | `VERCEL_WEBHOOK_SECRET` diferente do segredo do webhook |
| O deploy chega, mas não aparece | `DEMO_VERCEL_TEAM_ID` não ligado: o aviso de time desconhecido é descartado |
| "em produção" fica falso depois do merge | Ainda não há deploy de produção `ready` depois do merge, ou o projeto não está ligado ao repositório |
