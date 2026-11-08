import { loadConfig } from "@echo/config";
import type { PersonSchedule } from "@echo/domain";
import { panelDb } from "./db";
import type { Persona } from "./demo/types";
import { panelIds } from "./redistribution-server";

/** Distribuição e agenda com o banco do painel (import tardio). Sem banco, null. */
export async function workPlanningFlow() {
  const db = panelDb();
  if (!db) return null;
  const { serverWorkPlanning } = await import("@echo/agents/server");
  return serverWorkPlanning(db, loadConfig("web").PANEL_URL ?? "http://localhost:3000");
}

/** Agenda da pessoa. Falha na leitura não derruba a página: fica no log e a agenda não aparece. */
export async function loadAgenda(me: Persona): Promise<{ today: string; schedule: PersonSchedule } | null> {
  try {
    const flow = await workPlanningFlow();
    if (!flow) return null;
    const { orgId, personId } = panelIds(me);
    return await flow.schedule(orgId, personId);
  } catch (err) {
    console.error("agenda não foi lida", err instanceof Error ? err.message : String(err));
    return null;
  }
}
