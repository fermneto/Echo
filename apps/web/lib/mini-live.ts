import { loadAwayRows } from "./away-live";
import { currentDecisions } from "./decisions-store";
import { planFor } from "./demo/plan";
import type { Persona } from "./demo/types";
import { isDemoOrg } from "./gains";
import { messagesFromRows, tasksFromPlan, tasksFromSchedule, type MiniData } from "./mini";
import { loadAgenda } from "./work-planning";

/** Dados do Mini Echo para quem está logado: só leitura, das mesmas fontes de Meu plano e do Início. */
export async function loadMini(me: Persona, now: Date): Promise<MiniData> {
  const [agenda, away] = await Promise.all([loadAgenda(me), loadAwayRows(me, now)]);
  const decisions = agenda || !isDemoOrg(me.orgId) ? {} : await currentDecisions();
  const tasks = agenda ? tasksFromSchedule(agenda.schedule) : isDemoOrg(me.orgId) ? tasksFromPlan(planFor(me.id).filter((it) => !(it.id in decisions))) : [];
  return { agent: `Agente de ${me.name.trim().split(/\s+/)[0]}`, tasks, messages: messagesFromRows(away.rows) };
}
