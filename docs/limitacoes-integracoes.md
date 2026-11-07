# Echo — Limitações das integrações

> Gerado a partir do "Manual do Echo" (`docs/manual-do-echo.html`). Em divergência, vale: `limitacoes-integracoes.md`, `engenharia.md`, `produto.md`.

_Integrações_

### Limites e como contornar

alta

Termos do Slack restringem coleta e retenção.

Slack vira canal de pergunta e resposta, não fonte de conhecimento.

alta

Para detectar quem chamou alguém ausente, o app recebe mensagens dos canais em que foi convidado.

Avaliadas em memória. Só vira registro o que gera pergunta.

alta

Proteção de branch em privado exige plano pago no GitHub.

Repositório público com dados sintéticos.

alta

GitHub não reenvia avisos que falharam.

Rotina de reconciliação.

média

Jurados não entram em três espaços de teste.

Simulador no painel pelo mesmo fluxo.

média

Token do Linear expira em 24 h, o do GitHub em 1 h.

Renovação central, com trava.

### Slack

| Limite | Como contornar |
|---|---|
| Resposta em 3 s, até 3 novas tentativas | Gravar, enfileirar, responder 200 e deduplicar |
| Desativa com 95% de falhas em 60 min | `api` separada do `worker` |
| 30 mil eventos por hora por workspace | Só canais em que o app foi convidado, descarte na entrada |
| 1 mensagem por segundo por canal | Fila de envio e planos espaçados |
| Texto de até 4.000 caracteres | Resumo no Slack, detalhe no painel |
| Nome personalizado exige `chat:write.customize` | "Agente de Fernando" só em respostas, avisos pelo bot Echo |
| Fora do Marketplace, histórico de 1 consulta por minuto e 15 itens | Não depender de histórico |

**Venda:** app interno no evento, um app por cliente nos pilotos, Marketplace na escala (5 ou mais espaços ativos e revisão de 2 a 3 meses). Teams como alternativa pela interface `ChatPlatform`.

### GitHub

| Limite | Como contornar |
|---|---|
| Resposta a avisos em 10 s | Gravar, enfileirar, `X-GitHub-Delivery` |
| 5.000 requisições por hora por instalação | Espelho local, consulta ao vivo só do que está em questão |
| Limites secundários: 100 simultâneas, cerca de 80 criações por minuto | Fila por instalação e respeito a `retry-after` |
| Token de instalação dura 1 h | Um token por tarefa, com o mínimo necessário |
| PR com até 3.000 arquivos e 250 commits | Acima do limite, "PR grande demais para análise automática" |
| `mergeable` pode vir nulo | "Ainda em cálculo", sem afirmar |

### Linear

| Limite | Como contornar |
|---|---|
| 5.000 requisições e 2 milhões de pontos por hora | Avisos em vez de polling, consultas específicas |
| Resposta em 5 s, novas tentativas em 1 min, 1 h e 6 h | `Linear-Delivery` para deduplicar |
| Ordem dos avisos não garantida | Comparar `updatedAt` |
| App não pode pedir `admin` para criar avisos | Avisos configurados no próprio aplicativo OAuth |
| Plano gratuito: 250 tarefas e 2 times | Dados sintéticos com menos de 250 tarefas |

### RH

Interface `HrSource`. Na demo, cadastro no painel. Para clientes, POST assinado em `/webhooks/rh/o/<empresa>`:

```
{"id":"evento-1","employee_id":"123","starts_at":"2026-03-05T00:00:00-03:00",
"ends_at":"2026-03-20T00:00:00-03:00","kind":"vacation"}

x-echo-timestamp: segundos
x-echo-signature: HMAC-SHA256 hex de "."

cancelar: {"id":"evento-1","action":"cancel"}
```

Aviso com mais de 5 minutos é recusado. Repetir o mesmo `id` não duplica. Motivo é descartado. Matrícula desconhecida vira só uma contagem.
