// Plano da manhã na hora, para testar o fluxo de verdade (F5): põe na fila do worker o mesmo job que a agenda
// põe no início do expediente. O worker em produção faz o resto (regras, plano gravado e mensagem privada no
// Slack pelo outbox). Este comando não manda nada sozinho.
// - A data é a de hoje no fuso de cada pessoa. Quem já tem plano nessa data é avisado: o fluxo pula (um plano
//   por pessoa e dia).
// - A chave do job é própria (`:agora`), para não ocupar a da agenda.
// Pula quem está fora (inativo, RH ou ausente) e, por padrão, empresas sem integração (a de demonstração).
// Uso: pnpm manha:agora [--todas] [--pessoa <nome>]
import { createPgAgentData, createPgPlanStore } from "@echo/agents/server";
import { loadConfig } from "@echo/config";
import { asSystem, createDb, createPool, installationRoutes, orgs } from "@echo/db";
import { isAway, localDate } from "@echo/domain";
import { PgBossQueue, QUEUES } from "@echo/jobs";

const args = process.argv.slice(2);
const all = args.includes("--todas");
const who = args.includes("--pessoa") ? args[args.indexOf("--pessoa") + 1]?.toLowerCase() : undefined;

const cfg = loadConfig("worker");
// Uma conexão, com tempo maior: roda da máquina de quem testa contra o banco da Render (latência alta).
const pool = createPool(cfg.DATABASE_URL, 1, { connectTimeoutMs: 30_000 });
const db = createDb(pool);
const queue = new PgBossQueue(cfg.DATABASE_URL);
await queue.start();

const now = new Date();
const routed = new Set((await asSystem(db, (tx) => tx.select({ orgId: installationRoutes.orgId }).from(installationRoutes))).map((r) => r.orgId));
const list = (await asSystem(db, (tx) => tx.select({ id: orgs.id, name: orgs.name }).from(orgs))).filter((o) => all || routed.has(o.id));
if (!list.length) console.log("Nenhuma empresa com integração. Use --todas para incluir a de demonstração.");

for (const org of list) {
  console.log(`\n${org.name}`);
  const data = createPgAgentData(db, org.id);
  const plans = createPgPlanStore(db, org.id);
  const people = await data.people();
  const absences = await data.absences();
  for (const p of people) {
    if (who && !p.name.toLowerCase().includes(who)) continue;
    const name = p.name.padEnd(22);
    if (!p.active || p.role === "hr") { console.log(`  ${name} pulado (${p.role === "hr" ? "RH" : "inativo"})`); continue; }
    if (isAway(p, absences, now).reason === "absence") { console.log(`  ${name} pulado (ausente)`); continue; }
    const job = { orgId: org.id, personId: p.id, date: localDate(now, p.timezone) };
    if (await plans.get(p.id, job.date)) { console.log(`  ${name} plano de ${job.date} já existe: o fluxo pularia`); continue; }
    const id = await queue.send(QUEUES.morningPlan, job, { singletonKey: `${job.orgId}:${job.personId}:${job.date}:agora` });
    console.log(`  ${name} plano de ${job.date} na fila${id ? ` (job ${id})` : ""}`);
  }
}
console.log("\nO worker pega os jobs em segundos. Sem item, o plano fica só no painel e não há mensagem (regra do fluxo).");
await queue.stop();
await pool.end();
