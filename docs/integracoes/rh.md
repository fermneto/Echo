# Aviso de RH

## O que o Echo faz

- **Recebe** férias e afastamentos por `POST /webhooks/rh/o/<empresa>`, assinado com o segredo da empresa. Um aviso com mais de 5 minutos de diferença no horário é recusado.
- **Descarta o motivo na entrada:** só passam id, matrícula, início, fim e tipo (`vacation` ou `leave`). As datas exigem fuso.
- O mesmo id não duplica, e `{"id":…,"action":"cancel"}` cancela.
- Matrícula desconhecida vira **só uma contagem** na auditoria, sem a matrícula e sem as datas.
- Cada ausência registrada vai para a fila `absence.registered`, de onde sai o plano de redistribuição (frente Funções).

**PR:** #11.

## Formato

```
POST https://<API>/webhooks/rh/o/<id da empresa>
x-echo-timestamp: <segundos>
x-echo-signature: <HMAC-SHA256 hex de "<timestamp>.<corpo>">

{"id":"evento-1","employee_id":"123","starts_at":"2026-11-10T00:00:00-03:00","ends_at":"2026-11-21T23:59:59-03:00","kind":"vacation"}
{"id":"evento-1","action":"cancel"}
```

Respostas: `200 {"ok":true,"status":"registered"}`, ou `duplicate`, `cancelled`, `unknown_event` ou `unknown_employee`. Assinatura errada ou velha recebe 401, empresa sem segredo recebe 503 e corpo inválido recebe 400.

## Configurar

1. `ENCRYPTION_KEY` (`openssl rand -hex 32`) no `.env`, **igual na API e no comando abaixo**. O segredo do RH fica cifrado com ela.
2. A matrícula de cada pessoa em `DEMO_IDENTITIES` (`"rh": "123"`), depois `pnpm integracoes:ligar`.
3. Gerar o segredo da empresa:
   ```bash
   pnpm integracoes:rh
   # URL do aviso de RH: https://<API>/webhooks/rh/o/<empresa>
   # Segredo (mostrado só agora; trocar invalida o anterior): …
   ```
   Num sistema de RH de verdade, essa URL e esse segredo são o que se configura nele.

## Validar

```bash
pnpm integracoes:rh --enviar --matricula 123 --inicio 2026-11-10 --fim 2026-11-21 --api https://<API>
# Resposta: 200 {"ok":true,"status":"registered"}   (o corpo enviado traz "motivo", que é descartado)
pnpm integracoes:rh --enviar --cancelar <id do evento mostrado acima> --api https://<API>
# Resposta: 200 {"ok":true,"status":"cancelled"}
pnpm integracoes:rh --enviar --matricula 999 --api https://<API>
# Resposta: 200 {"ok":true,"status":"unknown_employee"}
```

```sql
select p.name, a.kind, a.source, a.starts_at, a.ends_at, a.cancelled_at from absences a join people p on p.id = a.person_id where a.source = 'hr' order by a.created_at desc limit 3;
select action, target from audit_log where actor = 'rh' order by created_at desc limit 5;
```

Esperado:
- a ausência com `source = hr`, e nenhuma coluna com o motivo;
- o cancelamento preenchido;
- a matrícula desconhecida só como `rh:matricula_desconhecida`.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| 503 | `ENCRYPTION_KEY` ausente na API, ou a empresa sem segredo (`pnpm integracoes:rh`) |
| 401 | Segredo trocado (gerar de novo invalida o anterior), ou o relógio com mais de 5 min de diferença |
| 400 | Data sem fuso (`-03:00` ou `Z`), fim antes do início, ou tipo diferente de `vacation`/`leave` |
| `unknown_employee` com a pessoa certa | Faltou `"rh"` dessa pessoa em `DEMO_IDENTITIES` |
