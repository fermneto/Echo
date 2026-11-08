// Rodar uma vez: `pnpm --filter @echo/reviewer provision-video`. Cria o agente e o ambiente da gravação do vídeo
// da entrega no Managed Agents e mostra os IDs para o .env (VIDEO_AGENT_ID e VIDEO_ENVIRONMENT_ID). Com os IDs já
// no .env, não cria nada de novo.
import { provisionVideo } from "@echo/agents/server";

const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY ausente no .env: o vídeo usa a chave da empresa.");
  process.exit(1);
}
const existing = { agentId: process.env.VIDEO_AGENT_ID?.trim() || undefined, environmentId: process.env.VIDEO_ENVIRONMENT_ID?.trim() || undefined };
const r = await provisionVideo(apiKey, existing);
console.log(r.created.length ? `Criado: ${r.created.join(" e ")}.` : "Nada novo criado: os IDs do .env continuam valendo.");
console.log("Coloque no .env (e nas variáveis do echo-worker na Render):");
console.log(`VIDEO_AGENT_ID=${r.agentId}`);
console.log(`VIDEO_ENVIRONMENT_ID=${r.environmentId}`);
