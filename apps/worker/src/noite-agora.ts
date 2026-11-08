// Revisão noturna na hora, para testar o fluxo de verdade: põe na fila do worker o mesmo job que a agenda põe
// às NIGHT_REVIEW_UTC_HOUR. O worker em produção faz o resto (diff do GitHub, triagem pelo modelo aberto, lote
// na Anthropic e, quando o lote termina, comentário no PR pelo outbox). Este comando não manda nada sozinho.
// Versão (head) já revisada é pulada pela regra do fluxo, então rodar de novo ou à noite não repete comentário.
// Por padrão, só empresas com integração (fora a de demonstração).
// Uso: pnpm noite:agora [--todas]
import { createPgAgentData } from "@echo/agents/server";
import { loadConfig } from "@echo/config";
import { asSystem, createDb, createPool, installationRoutes, orgs } from "@echo/db";
import { PgBossQueue, QUEUES } from "@echo/jobs";

const all = process.argv.slice(2).includes("--todas");

const cfg = loadConfig("worker");
// Uma conexão, com tempo maior: roda da máquina de quem testa contra o banco da Render (latência alta).
const pool = createPool(cfg.DATABASE_URL, 1, { connectTimeoutMs: 30_000 });
const db = createDb(pool);
const queue = new PgBossQueue(cfg.DATABASE_URL);
await queue.start();

const stamp = new Date().toISOString().slice(0, 16);
const routed = new Set((await asSystem(db, (tx) => tx.select({ orgId: installationRoutes.orgId }).from(installationRoutes))).map((r) => r.orgId));
const list = (await asSystem(db, (tx) => tx.select({ id: orgs.id, name: orgs.name }).from(orgs))).filter((o) => all || routed.has(o.id));
if (!list.length) console.log("Nenhuma empresa com integração. Use --todas para incluir a de demonstração.");

for (const org of list) {
  const prs = await createPgAgentData(db, org.id).pullRequests({ openOnly: true });
  const open = prs.filter((p) => p.state === "open");
  // Chave própria por minuto: não ocupa a da agenda da noite (`<org>:<dia>`).
  const queued = await queue.send(QUEUES.nightReview, { orgId: org.id }, { singletonKey: `${org.id}:agora:${stamp}` });
  console.log(`\n${org.name}: ${queued ? "revisão na fila" : "já na fila neste minuto"} (${open.length} PR aberto(s), ${prs.length - open.length} rascunho(s))`);
  for (const p of open) console.log(`  ${p.repository}#${p.number} ${p.title}`);
}
console.log(
  "\nO worker pega o job em segundos e envia o lote. O lote costuma terminar em minutos (até 24 h); o worker confere" +
    "\na cada passada da agenda e publica o comentário no PR. Sem ANTHROPIC_API_KEY no worker, nenhum lote sai.",
);
await queue.stop();
await pool.end();
