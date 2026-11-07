# Agenda: Google Workspace

## O que o Echo faz

- **Lê só os eventos de "fora do escritório"**: o tipo é filtrado na própria consulta (`eventTypes=outOfOffice`), e os campos pedidos se limitam a id, horário, tipo e estado. **Título, descrição e participantes nunca são pedidos.**
- **Ausência curta** (menos de 3 dias) vale na hora, marcada como inferida. Já conta para "quando volta".
- **Ausência longa** (3 dias ou mais) é tratada como férias e vira **sugestão para a liderança**, na fila `absence.suggested`. Nenhum plano de redistribuição é gerado antes da confirmação.
- **Evento movido** atualiza a ausência, e **evento apagado** a cancela.
- A API do Google Agenda **não informa o expediente**, então aqui não há sugestão de horário (a Microsoft informa).

**PR:** #15. Sincroniza na rodada de reconciliação (a cada 10 min) e com `pnpm integracoes:reconciliar`.

## Configurar (precisa de um Workspace de teste e de um administrador)

1. No **Google Cloud**, crie um projeto e ative a **Google Calendar API**.
2. Crie uma **conta de serviço** e uma chave JSON. O `client_email` vai para `GOOGLE_SERVICE_ACCOUNT_EMAIL`, e o `private_key` (em uma linha, com `\n`) vai para `GOOGLE_SERVICE_ACCOUNT_KEY`.
3. No **Admin do Workspace → Segurança → Controles de API → Delegação em todo o domínio**, adicione o *Client ID* da conta de serviço com o escopo:
   ```
   https://www.googleapis.com/auth/calendar.events.readonly
   ```
4. No `.env`: `DEMO_GOOGLE_DOMAIN=<seu domínio>` e, em `DEMO_IDENTITIES`, `"google": "<e-mail da pessoa>"`. Depois rode `pnpm integracoes:ligar`.

## Conferir

```bash
pnpm integracoes:agenda yan@seudominio.com google
# google: 1 períodos de fora do escritório nos próximos 60 dias (só id e horário):
#   2026-11-09T12:00:00.000Z → 2026-11-09T21:00:00.000Z  (…)
# Expediente: a agenda não informa (Google) ou não está definido.
```

## Validar

1. Na agenda do Yan, crie um **Fora do escritório** de algumas horas amanhã. Na do Eduardo, um de **10 dias** na semana que vem.
2. Rode `pnpm integracoes:reconciliar`.

```sql
select p.name, a.kind, a.inferred, a.confirmed_at is not null as vale, a.starts_at, a.ends_at, a.cancelled_at
from absences a join people p on p.id = a.person_id where a.source = 'calendar';
```

Esperado:
- **Yan:** `kind = ooo`, `vale = t`.
- **Eduardo:** `kind = vacation`, `vale = f`. É uma sugestão para a liderança, sem plano.

3. Mova o evento do Yan para outro horário e apague o do Eduardo. Rode de novo. O do Yan é atualizado, e o do Eduardo é cancelado (`cancelled_at` preenchido). Rodar outra vez, sem mudanças, não cria nada.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `invalid_grant` ou `unauthorized_client` | Falta a delegação no domínio com o escopo `calendar.events.readonly`, ou o e-mail não é do domínio |
| `403` | A Calendar API não está ativada no projeto |
| A ausência não aparece | Falta `"google"` em `DEMO_IDENTITIES`, falta `DEMO_GOOGLE_DOMAIN`, ou o evento não é do tipo "fora do escritório" |
