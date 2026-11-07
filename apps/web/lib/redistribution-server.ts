import { loadConfig } from "@echo/config";
import type { Persona } from "./demo/types";
import { panelDb } from "./db";
import { gainsOrgId } from "./gains";
import { personIdFor } from "./agent";
import { pendingPlanItem } from "./redistribution";

/** Empresa e pessoa do banco para quem está no painel (as personas da demo usam o seed). */
export const panelIds = (me: Persona) => ({ orgId: gainsOrgId(me.orgId), personId: personIdFor(me.id) });

/** Fluxo da redistribuição com o banco do painel (import tardio). */
export async function redistributionFlow() {
  const db = panelDb();
  if (!db) return null;
  const { serverRedistribution } = await import("@echo/agents/server");
  return serverRedistribution(db, loadConfig("web").PANEL_URL ?? "http://localhost:3000");
}

/**
 * Planos de ausência esperando esta liderança, para Meu plano e "Tarefas aguardando você". Null sem banco (vale a demo).
 * Falha na leitura não derruba a página: fica no log e a lista vem vazia.
 */
export async function pendingPlans(me: Persona, now: Date): Promise<ReturnType<typeof pendingPlanItem>[] | null> {
  const db = panelDb();
  if (!db) return null;
  if (me.role !== "leader") return [];
  try {
    const { awaitingPlansFor } = await import("@echo/agents/redistribuicao");
    const { orgId, personId } = panelIds(me);
    return (await awaitingPlansFor(db, orgId, personId, now)).map((p) => pendingPlanItem(p, now, me.timezone));
  } catch (err) {
    console.error("planos de redistribuição não foram lidos", err instanceof Error ? err.message : String(err));
    return [];
  }
}
