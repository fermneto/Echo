# Agenda: Microsoft 365

## O que o Echo faz

- **Lê só id, horário e "mostrar como"** dos eventos (`$select=id,start,end,showAs`) e considera os marcados como **fora do escritório** (`oof`). **O assunto nunca é pedido**, nem o conteúdo de e-mails.
- **Resposta automática agendada** também conta como fora do escritório.
- **Expediente da caixa** (dias, horário e fuso) diferente do cadastrado vira **sugestão**, que só vale quando a pessoa aceita. Os fusos do Windows mais comuns viram IANA (ex.: `E. South America Standard Time` → `America/Sao_Paulo`).
- **Ausências curtas e longas** seguem a mesma regra do [Google](agenda-google.md): a curta vale na hora, e a longa vira sugestão para a liderança.

**PR:** #15.

## Configurar (precisa de um tenant de teste e de um administrador)

1. No **Microsoft Entra → Registros de aplicativo**, registre um app **multi-tenant** e crie um segredo. Vão para `MICROSOFT_CLIENT_ID` e `MICROSOFT_CLIENT_SECRET`.
2. Em **Permissões de API → Microsoft Graph → Permissões de aplicativo**, adicione `Calendars.ReadBasic` e `MailboxSettings.Read` e clique em **Conceder consentimento do administrador**.
3. No `.env`: `DEMO_MICROSOFT_TENANT_ID=<id do tenant>` (Entra → Visão geral) e, em `DEMO_IDENTITIES`, `"microsoft": "<e-mail da pessoa>"`. Depois rode `pnpm integracoes:ligar`.

## Conferir

```bash
pnpm integracoes:agenda eduardo@seudominio.com microsoft
# microsoft: 2 períodos de fora do escritório nos próximos 60 dias (só id e horário):
#   …
# Expediente na agenda: 08:00–17:00, dias 1,2,3,4,5, Africa/Johannesburg
```

## Validar

1. Crie um evento com **Mostrar como: Fora do escritório** de algumas horas amanhã, e ligue uma **resposta automática agendada** de 10 dias em outra pessoa.
2. Mude o horário de trabalho de alguém em **Outlook → Configurações → Calendário**.
3. Rode `pnpm integracoes:reconciliar`.

```sql
select p.name, a.kind, a.inferred, a.confirmed_at is not null as vale from absences a join people p on p.id = a.person_id where a.source = 'calendar';
select name, work_hours, work_hours_suggested from people where work_hours_suggested is not null;
```

Esperado:
- a ausência curta valendo, e a longa como sugestão;
- o expediente da caixa em `work_hours_suggested`, enquanto o `work_hours` continua o cadastrado até a pessoa aceitar.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `AADSTS700016` / `AADSTS7000215` | App ou segredo errado, ou o app não é multi-tenant |
| `403 Forbidden` no Graph | Faltam as permissões de aplicativo, ou o consentimento do administrador |
| O expediente não é sugerido | Fuso do Windows fora da tabela de conversão: o Echo não arrisca e não sugere |
