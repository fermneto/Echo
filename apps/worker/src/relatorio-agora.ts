// Relatório semanal na hora, para ensaiar a cena 4 e o e2e: gera agora os relatórios cujo corte (fim do último
// expediente da semana) já passou e que ainda não existem. É o mesmo `build` que a agenda do worker chama; um
// relatório por pessoa e semana, então rodar de novo não duplica. Sem ANTHROPIC_API_KEY, o texto sai por regra.
// Não envia nada ao RH: o envio continua seguindo o prazo de 3 dias depois do aviso.
// Por padrão, só a empresa de demonstração (sem integração). Uso: pnpm relatorio:agora [--todas]
import { allOrgIds, dueWeeklyReports, serverWeeklyReport } from "@echo/agents/server";
import { loadConfig } from "@echo/config";
import { asSystem, createDb, createPool, installationRoutes } from "@echo/db";

const all = process.argv.slice(2).includes("--todas");

const cfg = loadConfig("worker");
const pool = createPool(cfg.DATABASE_URL, 1, { connectTimeoutMs: 30_000 });
const db = createDb(pool);

const routed = new Set((await asSystem(db, (tx) => tx.select({ orgId: installationRoutes.orgId }).from(installationRoutes))).map((r) => r.orgId));
const orgs = new Set((await allOrgIds(db)).filter((id) => all || !routed.has(id)));
const flow = serverWeeklyReport(db, cfg.ANTHROPIC_API_KEY, cfg.WEB_URL);

const due = (await dueWeeklyReports(db, new Date())).filter((d) => orgs.has(d.orgId));
if (!due.length) console.log("Nenhum relatório pendente: os desta semana já existem ou o corte ainda não passou.");
for (const d of due) {
  const out = await flow.build(d.orgId, d.personId, d.week, new Date(d.cutoff));
  console.log(`${d.week} · ${d.personId}: ${out.status === "created" ? `gerado${out.usedModel ? "" : " (texto por regra)"}` : `pulado (${out.reason})`}`);
}
await pool.end();
