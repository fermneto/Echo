// Teste real do executor: coloca ações no outbox, registra a aprovação e executa nas plataformas reais.
// Uso: pnpm acao:testar --tarefa ECH-1 --para "Carla" --aprovador "Marina" [--canal C0123] [--pr org/repo#12]
import { parseArgs } from "node:util";
import { createDb, createPool, orgs, outboxActions, people, tasks } from "@echo/db";
import { and, eq, inArray } from "drizzle-orm";
import { approveAction, drainActions, enqueueAction } from "./executor.ts";
import { writersFromEnv } from "./writers.ts";

const { values: a } = parseArgs({
  // O pnpm pode repassar um "--" solto antes dos argumentos.
  args: process.argv.slice(2).filter((x) => x !== "--"),
  options: {
    tarefa: { type: "string" },
    para: { type: "string" },
    aprovador: { type: "string" },
    canal: { type: "string" },
    pr: { type: "string" },
  },
});
const env = process.env;
const fail = (msg: string): never => {
  console.error(msg);
  process.exit(1);
};
if (!env.DATABASE_URL) fail("DATABASE_URL ausente no .env.");
if (!a.tarefa && !a.canal && !a.pr) fail('Diga o que testar: --tarefa ECH-1 --para "Carla" --aprovador "Marina", --canal C0123 e/ou --pr org/repo#12');

const pool = createPool(env.DATABASE_URL!, 2);
const db = createDb(pool);
const [org] = await db.select().from(orgs).where(eq(orgs.name, env.DEMO_ORG_NAME ?? "Empresa de teste (integrações)"));
if (!org) fail("Empresa de teste não encontrada: rode antes pnpm integracoes:ligar.");
const orgId = org!.id;
const person = async (name: string) => {
  const [p] = await db.select().from(people).where(and(eq(people.orgId, orgId), eq(people.name, name)));
  return p ?? fail(`Pessoa "${name}" não está na empresa de teste (DEMO_IDENTITIES).`);
};
const stamp = new Date().toISOString();
const created: string[] = [];

if (a.tarefa) {
  if (!a.para || !a.aprovador) fail("--tarefa precisa de --para e --aprovador (a mudança de responsável exige aprovação).");
  const [task] = await db.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.key, a.tarefa!)));
  if (!task) fail(`Tarefa ${a.tarefa} não importada. Rode pnpm integracoes:ligar com o Linear configurado.`);
  const to = await person(a.para!);
  const approver = await person(a.aprovador!);
  const assign = await enqueueAction(db, orgId, { type: "linear.assign", target: `linear:${a.tarefa}`, idempotencyKey: `teste:${stamp}:assign`, payload: { taskKey: a.tarefa!, toPersonId: to.id } });
  console.log(`1. Ação no outbox, aguardando aprovação: mudar ${a.tarefa} para ${to.name}`);
  const before = await drainActions({ db, writers: writersFromEnv(db, env) }, orgId);
  console.log(`2. Execução antes de aprovar: ${before.done} feitas (esperado: 0)`);
  await approveAction(db, orgId, assign.id, approver.id);
  console.log(`3. Aprovada por ${approver.name}`);
  const comment = await enqueueAction(db, orgId, {
    type: "linear.comment",
    target: `linear:${a.tarefa}`,
    idempotencyKey: `teste:${stamp}:comment`,
    payload: { taskKey: a.tarefa!, body: `Responsável alterado para ${to.name} pelo Echo, com aprovação de ${approver.name}. (teste de integração)` },
    approvedBy: approver.id,
  });
  created.push(assign.id, comment.id);
}
if (a.canal) {
  const post = await enqueueAction(db, orgId, { type: "slack.post", target: `slack:${a.canal}`, idempotencyKey: `teste:${stamp}:slack`, payload: { channel: a.canal!, text: "Teste de integração do Echo: esta mensagem saiu pelo outbox." } });
  created.push(post.id);
}
if (a.pr) {
  const m = a.pr!.match(/^([^#]+)#(\d+)$/) ?? fail("--pr no formato org/repo#12");
  const c = await enqueueAction(db, orgId, { type: "github.comment", target: `github:${a.pr}`, idempotencyKey: `teste:${stamp}:gh`, payload: { repo: m[1]!, number: Number(m[2]), body: "Teste de integração do Echo: comentário enviado pelo outbox. Isto não é uma aprovação." } });
  created.push(c.id);
}

const result = await drainActions({ db, writers: writersFromEnv(db, env) }, orgId);
console.log(`4. Executadas: ${result.done} · falharam: ${result.failed} · para tentar de novo: ${result.retried}`);
const rows = await db.select().from(outboxActions).where(inArray(outboxActions.id, created));
for (const r of rows) console.log(`   ${r.state.padEnd(8)} ${r.type.padEnd(16)} ${r.target}${r.error ? ` · ${r.error}` : ""}`);
await pool.end();
process.exit(result.failed ? 1 : 0);
