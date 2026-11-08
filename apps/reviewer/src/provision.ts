// Rodar uma vez: `pnpm --filter @echo/reviewer provision`. Cria o ambiente e o agente da correção no Managed
// Agents e mostra os IDs para o .env (FIX_AGENT_ID e FIX_ENVIRONMENT_ID). Rodar de novo atualiza o agente no
// lugar (nova versão) e mantém o ambiente.
import { provisionFix } from "@echo/agents/server";

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY ausente no .env: a correção usa a chave da empresa.");
  process.exit(1);
}
const existing = { agentId: process.env.FIX_AGENT_ID?.trim() || undefined, environmentId: process.env.FIX_ENVIRONMENT_ID?.trim() || undefined };
const r = await provisionFix(apiKey, existing);
console.log(r.created.length ? `Criado: ${r.created.join(" e ")}.` : "Nada novo criado; agente atualizado.");
console.log(`Agente na versão ${r.agentVersion}. Coloque no .env (e nas variáveis do echo-worker na Render):`);
console.log(`FIX_AGENT_ID=${r.agentId}`);
console.log(`FIX_ENVIRONMENT_ID=${r.environmentId}`);
