// pnpm evals — avaliação fixa de segurança com o modelo real (frente Avaliador).
// Metas: nenhuma violação de permissão, nenhuma liberação falsa, nenhuma obediência a instrução injetada.
// Falha de segurança faz o comando falhar; falha de conteúdo é medida e relatada.
import * as agents from "@echo/agents";
import { createPool } from "@echo/db";
import type { AnswerRequest, AnswerResult } from "@echo/agents";
import { BASE_CHECKS, CASES, type EvalCase, type Persona } from "./cases.ts";

export { CASES } from "./cases.ts";

/** O fluxo de resposta da frente Funções (etapa 6). */
type Answer = (req: AnswerRequest) => Promise<AnswerResult>;

/** Ids das personas na empresa de demonstração, vindos do seed. */
export type PersonaIds = Record<Persona, string>;

export interface CaseOutcome {
  name: string;
  security: boolean;
  problems: string[];
  result?: AnswerResult;
}

export async function runCase(c: EvalCase, answer: Answer, orgId: string, ids: PersonaIds): Promise<CaseOutcome> {
  const security = c.security ?? false;
  try {
    const result = await answer({
      orgId,
      askerId: ids[c.asker],
      ...(c.owner && { ownerId: ids[c.owner] }),
      text: c.text,
      channel: "simulador",
      ...(c.thread && { thread: c.thread }),
    });
    const base = BASE_CHECKS.flatMap((check) => check(result));
    // Uma checagem-base quebrada é sempre falha de segurança, mesmo num caso de conteúdo.
    return { name: c.name, security: security || base.length > 0, problems: [...base, ...c.check(result)], result };
  } catch (error) {
    return { name: c.name, security, problems: [`erro: ${error instanceof Error ? error.message : String(error)}`] };
  }
}

const PERSONA_NAMES: Record<Persona, string> = {
  fernando: "Fernando",
  eduardo: "Eduardo",
  yan: "Yan",
  marina: "Marina",
  bruno: "Bruno",
  carla: "Carla",
  rita: "Rita",
};

/** Acha a empresa de demonstração e as personas que o seed criou. */
async function loadDemo(databaseUrl: string): Promise<{ orgId: string; ids: PersonaIds }> {
  const pool = createPool(databaseUrl, 1);
  try {
    const org = await pool.query<{ id: string }>("select id from orgs where is_demo order by created_at desc limit 1");
    const orgId = org.rows[0]?.id;
    if (!orgId) throw new Error("empresa de demonstração não encontrada; rode pnpm db:seed");
    const people = await pool.query<{ id: string; name: string }>("select id, name from people where org_id = $1", [orgId]);
    const byName = new Map(people.rows.map((p) => [p.name.split(" ")[0], p.id]));
    const ids = Object.fromEntries(
      Object.entries(PERSONA_NAMES).map(([persona, name]) => {
        const id = byName.get(name);
        if (!id) throw new Error(`persona ${name} não está no seed`);
        return [persona, id];
      }),
    ) as PersonaIds;
    return { orgId, ids };
  } finally {
    await pool.end();
  }
}

async function main() {
  const answer = (agents as { answer?: Answer }).answer;
  if (!answer) {
    console.error(`evals: ${CASES.length} casos definidos, mas o fluxo answer() ainda não existe em @echo/agents (etapa 6)`);
    process.exitCode = 1;
    return;
  }
  const { DATABASE_URL } = process.env;
  if (!DATABASE_URL) throw new Error("Defina DATABASE_URL");
  const { orgId, ids } = await loadDemo(DATABASE_URL);

  let securityFailures = 0;
  let contentFailures = 0;
  for (const c of CASES) {
    const out = await runCase(c, answer, orgId, ids);
    const failed = out.problems.length > 0;
    if (failed && out.security) securityFailures++;
    else if (failed) contentFailures++;
    console.log(`${failed ? "FALHA" : "ok   "} ${out.security ? "[segurança] " : ""}${c.name}${failed ? `: ${out.problems.join("; ")}` : ""}`);
    if (failed && out.result) console.log(`      ${out.result.agentName}: ${out.result.text.replace(/\n/g, " ").slice(0, 400)}`);
  }
  const passed = CASES.length - securityFailures - contentFailures;
  console.log(`\n${passed} de ${CASES.length} passaram. Segurança: ${securityFailures} falha(s). Conteúdo: ${contentFailures} falha(s).`);
  if (securityFailures > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
