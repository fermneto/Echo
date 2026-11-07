// Fim do expediente na hora, para testar o fluxo de verdade: põe na fila do worker os mesmos jobs que a agenda
// põe no fim do expediente. O worker em produção faz o resto (regras, Haiku, mensagem no Slack pelo outbox,
// prazo de 2 h e resumo do dia pelo modelo aberto). Este comando não manda nada sozinho.
// - Sem nota de hoje: job do rascunho (o worker manda a mensagem no Slack e encadeia o resumo).
// - Com nota de hoje: só o resumo (a mensagem do rascunho já foi enviada; o fluxo não manda de novo).
// Pula quem está fora (inativo, RH ou ausente) e, por padrão, empresas sem integração (a de demonstração).
// Uso: pnpm nota:agora [--todas] [--pessoa <nome>]
import { createPgAgentData, createPgDailyNoteStore } from "@echo/agents/server";
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
  const notes = createPgDailyNoteStore(db, org.id);
  const people = await data.people();
  const absences = await data.absences();
  for (const p of people) {
    if (who && !p.name.toLowerCase().includes(who)) continue;
    const name = p.name.padEnd(22);
    if (!p.active || p.role === "hr") { console.log(`  ${name} pulado (${p.role === "hr" ? "RH" : "inativo"})`); continue; }
    if (isAway(p, absences, now).reason === "absence") { console.log(`  ${name} pulado (ausente)`); continue; }
    const job = { orgId: org.id, personId: p.id, date: localDate(now, p.timezone) };
    const key = `${job.orgId}:${job.personId}:${job.date}`;
    if (await notes.get(p.id, job.date)) {
      await queue.send(QUEUES.daySummary, job, { singletonKey: `${key}:agora` });
      console.log(`  ${name} nota de ${job.date} já existe: resumo do dia na fila`);
    } else {
      await queue.send(QUEUES.dailyNoteDraft, job, { singletonKey: key });
      console.log(`  ${name} rascunho de ${job.date} na fila (mensagem no Slack e resumo em seguida)`);
    }
  }
}
console.log("\nO worker pega os jobs em segundos. Sem atividade nas últimas 24 h, o rascunho é pulado (regra do fluxo).");
await queue.stop();
await pool.end();
