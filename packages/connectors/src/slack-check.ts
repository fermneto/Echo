// Confere o token do bot do Slack e mostra o que o seed precisa (DEMO_SLACK_TEAM_ID e o bot).
// Uso: pnpm --filter @echo/connectors slack:check
import { SlackChat } from "./slack-client.ts";

const token = process.env.SLACK_BOT_TOKEN;
if (!token) {
  console.error("SLACK_BOT_TOKEN ausente no .env (modelo em .env.example).");
  process.exit(1);
}
const chat = new SlackChat({ token });
try {
  const me = await chat.authTest();
  console.log(`Token ok. Bot: ${me.userId} · espaço (DEMO_SLACK_TEAM_ID): ${me.teamId}`);
  const users = await chat.listUsers();
  console.log(`${users.length} pessoas no espaço:`);
  for (const u of users) console.log(`  ${u.id}  ${u.name}${u.tz ? `  (${u.tz})` : ""}`);
} catch (err) {
  console.error("Falha ao falar com o Slack:", err instanceof Error ? err.message : err);
  console.error("Confira o token e os escopos (users:read, chat:write, chat:write.customize). Reinstale o app ao mudar escopos.");
  process.exit(1);
}
