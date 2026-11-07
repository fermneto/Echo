// Confere o app do Linear e mostra o id da organização (DEMO_LINEAR_ORG_ID).
// Uso: pnpm --filter @echo/connectors linear:check
import { LinearTracker } from "./linear-client.ts";

const { LINEAR_CLIENT_ID: clientId, LINEAR_CLIENT_SECRET: clientSecret, LINEAR_API_KEY: apiKey } = process.env;
if (!apiKey && (!clientId || !clientSecret)) {
  console.error("Defina LINEAR_CLIENT_ID e LINEAR_CLIENT_SECRET (app OAuth) ou LINEAR_API_KEY (chave pessoal) no .env.");
  process.exit(1);
}
const linear = new LinearTracker(apiKey ? { token: apiKey } : { clientId: clientId!, clientSecret: clientSecret! });
try {
  const org = await linear.organization();
  console.log(`App ok. Organização (DEMO_LINEAR_ORG_ID): ${org.id} · ${org.name}`);
  const users = await linear.listUsers();
  console.log(`${users.length} pessoas (ids para DEMO_IDENTITIES):`);
  for (const u of users) console.log(`  ${u.id}  ${u.name}`);
  const { tasks, truncated } = await linear.listOpenTasks();
  console.log(`${tasks.length}${truncated ? "+" : ""} tarefas abertas:`);
  for (const t of tasks.slice(0, 20)) console.log(`  ${t.key}  ${t.state}  ${t.title}`);
} catch (err) {
  console.error("Falha ao falar com o Linear:", err instanceof Error ? err.message : err);
  process.exit(1);
}
